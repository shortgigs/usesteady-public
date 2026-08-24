/**
 * src/session/controller.ts
 *
 * M5 — SessionController.
 *
 * Single-owner model for `process.stdin` and the interactive session loop.
 * Per design `docs/SESSION_CONTROLLER_DESIGN.md` (DRAFT v1.0, PR #229 merged
 * as `9ce293e`) the controller is the only component that reads stdin; every
 * other component that needs input from the user asks the controller via an
 * `InputRequest` event and receives the result via `InputDelivered`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M5 migration complete (commits 1-8 of §13)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  This file is the post-migration SessionController:
 *
 *   - §6.1 — the 8-state `SessionState` enum
 *   - §7.1 — the 4-family `SessionEvent` tagged union
 *   - §6.2 — the full `transition()` function (pure; data-driven)
 *   - §7.2 — the `SessionController` class owning the event queue and the
 *            single `readline.Interface` against `process.stdin`
 *
 *  Every previous `createInterface` call-site and every direct
 *  `process.stdin` async-iterator audited in design §3 has been retired;
 *  the controller is the only remaining owner. The CI grep guard in
 *  `release:gate` (scripts/check-stdin-ownership.mjs, enabled in commit 8)
 *  enforces this mechanically for every future change.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M5 invariants (load-bearing — see design §5)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  1. Single stdin owner. No `createInterface(`, `process.stdin.on`,
 *     `process.stdin.once`, `process.stdin.read`, `process.stdin.resume`,
 *     `process.stdin.pause`, `process.stdin.setRawMode`, or
 *     `for await (... of process.stdin)` appears in `src/` outside this
 *     file. CI-enforced. (Parent doc §4.3.)
 *
 *  2. Gates yield, never close. Components that need input call
 *     `controller.requestInput(...)` and return. They never construct a
 *     readline interface. They never call `process.stdin.destroy()`.
 *     (§5.1 + §7.4.)
 *
 *  3. Single state machine. The controller is always in exactly one of the
 *     8 states in §6.1. Every CLI output message corresponds to one state.
 *     No message is produced that implies a state the controller is not in.
 *     This forbids the GH-23 "error printed AND prepared printed" pattern.
 *     (§5.2 invariant 1.)
 *
 *  4. Events, not reads. Every component that needs input declares its need
 *     as `InputRequest`; the controller replies with `InputDelivered`. The
 *     component never touches `process.stdin`. (§5.2 invariant 2.)
 *
 *  5. No session drop on error. `Error` events transition to `ERROR`, present
 *     the error, then transition back to `INTAKE` (interactive) or to
 *     `COMPLETE` (one-shot). The process does not exit from mid-pipeline; one-
 *     shot mode exits by transitioning to `COMPLETE`, not by `process.exit()`
 *     from inside a normalizer or validator. (§5.2 invariant 3.)
 *
 *  6. External behavior preservation. Stdout/stderr bytes, exit codes, error
 *     codes, telemetry schema are identical to M4. The only observable diff
 *     is that sessions no longer die. (§5.2 invariant 4; §9 preservation
 *     table.)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  What this file does NOT do
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   - It does not call `normalizeNLToIR` (M4), `validateIR` (M3), or the
 *     workflow executor. Those hooks land in commits 4-5 as migration targets.
 *   - It does not handle approval vocabulary parsing (`y`/`yes`/`n`/`no`/
 *     `edit`). That lands in commit 2 when one-shot approvals migrate.
 *   - It does not install `SIGINT` / `SIGTERM` handlers yet. That lands in
 *     commit 4 when REPL loops migrate, because the current loops already
 *     install their own handlers and consolidating them earlier would churn.
 *   - It does not change any external behavior (§5.2 invariant 6). At HEAD of
 *     this commit, no code in `src/` imports this module yet.
 */
export const ALL_SESSION_STATES = [
    "IDLE",
    "INTAKE",
    "NORMALIZE",
    "VALIDATE",
    "AWAITING_APPROVAL",
    "EXECUTING",
    "ERROR",
    "COMPLETE",
];
/**
 * §6.2 transition table, expressed as a pure function so it is trivially
 * testable and the coverage test in `tests/session/controller.test.ts` can
 * assert every documented row is reachable.
 *
 * The function is a switch over `state` then `event.kind`. Reading top-to-
 * bottom, it matches the transition table in §6.2 row-by-row. Where an
 * event is valid in multiple states, it appears in each state's branch.
 *
 * Events that are not documented as valid for a state return
 * `"invariant_violation"`. The dispatcher (§7.2) handles that by
 * transitioning to ERROR and logging the offending pair; it does NOT throw.
 */
export function transition(state, event, mode) {
    // Exit / SIGINT / SIGTERM is valid in every non-terminal state (§6.2
    // last row: "(any non-terminal) ── Exit / SIGINT / SIGTERM ──► COMPLETE").
    if (event.kind === "Exit") {
        return state === "COMPLETE" ? "invariant_violation" : "COMPLETE";
    }
    switch (state) {
        case "IDLE":
            if (event.kind === "Tick")
                return "INTAKE";
            return "invariant_violation";
        case "INTAKE":
            if (event.kind === "InputDelivered")
                return "NORMALIZE";
            return "invariant_violation";
        case "NORMALIZE":
            if (event.kind === "NormalizeOk")
                return "VALIDATE";
            if (event.kind === "NormalizeError")
                return "ERROR";
            return "invariant_violation";
        case "VALIDATE":
            if (event.kind === "ValidateOk")
                return "AWAITING_APPROVAL";
            if (event.kind === "ValidateError")
                return "ERROR";
            return "invariant_violation";
        case "AWAITING_APPROVAL":
            if (event.kind === "Approved")
                return "EXECUTING";
            if (event.kind === "Rejected")
                return mode === "interactive" ? "INTAKE" : "COMPLETE";
            if (event.kind === "Retry")
                return "NORMALIZE";
            return "invariant_violation";
        case "EXECUTING":
            if (event.kind === "ExecuteOk")
                return mode === "interactive" ? "INTAKE" : "COMPLETE";
            if (event.kind === "ExecuteError")
                return "ERROR";
            // Sub-execution input (§7.3): InputRequest while EXECUTING does not
            // change state — the controller borrows stdin, reads a line, delivers
            // it back, executor resumes. The dispatcher handles the borrow-and-
            // deliver; from the state-machine perspective the state stays put.
            if (event.kind === "InputRequest")
                return "EXECUTING";
            if (event.kind === "InputDelivered")
                return "EXECUTING";
            return "invariant_violation";
        case "ERROR":
            if (event.kind === "ErrorShown")
                return mode === "interactive" ? "INTAKE" : "COMPLETE";
            return "invariant_violation";
        case "COMPLETE":
            // Terminal. No event is valid from here. (Exit handled above returns
            // "invariant_violation" because Exit from COMPLETE is a dispatcher bug.)
            return "invariant_violation";
    }
}
// ─── §7.2 SessionController class ───────────────────────────────────────────
/**
 * The single owner of stdin for the process lifetime.
 *
 * Commit 1 of §13 intentionally ships a minimal class: the state machine is
 * complete and tested (pure `transition()`), but the class is wired only for
 * the controller's own use. Subsequent commits migrate call-sites to it.
 *
 * Design notes:
 *
 *  - The internal `readline.Interface` is created lazily on first use of
 *    `requestInput()`. This keeps process startup cheap and lets tests
 *    instantiate the controller without touching stdin.
 *
 *  - `requestInput()` returns a Promise that resolves with the next line (or
 *    the full EOF buffer when `until === "eof"`). This is the single public
 *    entry point for every gate.
 *
 *  - `currentState()` is exposed for tests and for the CI-enforceable
 *    invariant that "the CLI is in exactly one state at any time" (§5.2
 *    invariant 3). Production code does not branch on it.
 */
export class SessionController {
    _state;
    mode;
    autoYes;
    stdin;
    stdout;
    terminal;
    // Lazily created on first requestInput. Closed exactly once on shutdown.
    rl = null;
    constructor(config) {
        this._state = "IDLE";
        this.mode = config.mode;
        this.autoYes = config.autoYes;
        this.stdin = config.stdin ?? process.stdin;
        this.stdout = config.stdout ?? process.stdout;
        this.terminal = config.terminal ?? Boolean(process.stdin.isTTY);
    }
    /** Current state. Read-only view. Used by tests and `release:gate`. */
    currentState() {
        return this._state;
    }
    /** Construction-time mode. Read-only. */
    sessionMode() {
        return this.mode;
    }
    /** `--yes` flag. Commit 2 uses this to auto-approve AWAITING_APPROVAL. */
    isAutoYes() {
        return this.autoYes;
    }
    /**
     * Apply an event to the current state. Returns the next state. Invariant
     * violations downgrade to ERROR with `code: "invariant_violation"` rather
     * than throwing (§5.2 invariant 5, §8.5).
     *
     * This is the *only* writer of `this._state`.
     */
    dispatch(event) {
        const next = transition(this._state, event, this.mode);
        if (next === "invariant_violation") {
            // Defense-in-depth (§8.5). Do not throw. The caller (event loop in
            // commit 2+) logs a CliError { stage: "session", code:
            // "invariant_violation" } and continues. For commit 1 we only transition
            // — presentation is added alongside the event loop in commit 2.
            this._state = "ERROR";
            return this._state;
        }
        this._state = next;
        return this._state;
    }
    /**
     * Borrow stdin for a single line read (or for an EOF-bulk read).
     *
     * Commit 1 wires this as the controller's only stdin touch point. The
     * implementation is intentionally straightforward: a single
     * `readline.Interface` created once against `this.stdin`, kept alive for
     * the lifetime of the controller, and closed in `shutdown()`.
     *
     * Until commit 2, no call-site invokes this. It is covered by an
     * injection-based test (`tests/session/controller.test.ts` "requestInput
     * borrows stdin").
     */
    async requestInput(params) {
        const { prompt, until } = params;
        if (until === "eof") {
            // Bulk read (stdin-pipe, §7.5). No readline — just drain the stream.
            // This is the future home of entry 10 in design §3 (use-steady.ts:311).
            // Migration lands in commit 3.
            const chunks = [];
            for await (const chunk of this.stdin) {
                chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
            }
            return Buffer.concat(chunks).toString("utf8");
        }
        // Line read. Lazily construct the single readline interface. Every gate
        // funnels through this one `rl`, so Node never sees two competing
        // interfaces on `process.stdin` (the root cause of GH-22 per §2 of the
        // design doc).
        if (this.rl === null) {
            const readline = await import("node:readline");
            this.rl = readline.createInterface({
                input: this.stdin,
                output: this.stdout,
                terminal: this.terminal,
            });
        }
        const rl = this.rl;
        return new Promise((resolve) => {
            rl.question(prompt, (answer) => resolve(answer));
        });
    }
    /**
     * Release stdin exactly once. Reserved for process exit (§7.4): gates
     * must never call this. Called from the event loop's COMPLETE on-enter
     * effect (wired in commit 2 when the loop lands).
     */
    shutdown() {
        if (this.rl !== null) {
            this.rl.close();
            this.rl = null;
        }
    }
}
//# sourceMappingURL=controller.js.map