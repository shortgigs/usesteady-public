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
import type { CliError } from "../input/cli-error.js";
/**
 * The 8 session states. Design §6.1.
 *
 * Every instant of the CLI's runtime, from process start to process exit,
 * corresponds to exactly one of these.
 */
export type SessionState = "IDLE" | "INTAKE" | "NORMALIZE" | "VALIDATE" | "AWAITING_APPROVAL" | "EXECUTING" | "ERROR" | "COMPLETE";
export declare const ALL_SESSION_STATES: readonly SessionState[];
/**
 * Interactive vs. one-shot is a constructor-time property, not a state
 * (§6.3). The same transition table applies; only the destinations for
 * `Rejected` / `ExecuteOk` / `ErrorShown` differ.
 */
export type SessionMode = "interactive" | "one_shot";
/**
 * Purpose tags on `InputRequest` / `InputDelivered` events. These tell the
 * controller which state to resume in (or which sub-read is active during
 * EXECUTING — §7.3), and let tests assert "this was the credential gate"
 * without string-matching prompts.
 */
export type InputPurpose = "nl_input" | "approval" | "credential" | "onboarding_step" | "retry_picker" | "bulk" | "setup" | "friction_report";
/**
 * The 4-family event taxonomy (§7.1). Every interaction with the controller
 * is exactly one of these. Components that produce events *return* them to
 * the controller — they never call `process.exit`, `rl.close()`, or direct
 * console.error for user-visible errors.
 */
export type SessionEvent = {
    readonly kind: "Tick";
} | {
    readonly kind: "Exit";
    readonly reason: "user" | "eof" | "signal";
} | {
    readonly kind: "InputRequest";
    readonly purpose: InputPurpose;
    readonly prompt: string;
    /** "line" reads a single line; "eof" reads to EOF (stdin-pipe, §7.5). */
    readonly until?: "line" | "eof";
} | {
    readonly kind: "InputDelivered";
    readonly purpose: InputPurpose;
    readonly text: string;
} | {
    readonly kind: "NormalizeOk";
    readonly ir: unknown;
} | {
    readonly kind: "NormalizeError";
    readonly error: CliError;
} | {
    readonly kind: "ValidateOk";
    readonly workflow: unknown;
} | {
    readonly kind: "ValidateError";
    readonly error: CliError;
} | {
    readonly kind: "Approved";
} | {
    readonly kind: "Rejected";
} | {
    readonly kind: "Retry";
    readonly text: string;
} | {
    readonly kind: "ExecuteOk";
    readonly result: unknown;
} | {
    readonly kind: "ExecuteError";
    readonly error: CliError;
} | {
    readonly kind: "ErrorShown";
};
/**
 * Result of applying an event to a state. Either a next state, or the
 * sentinel `"invariant_violation"` meaning "this (state, event) pair is not
 * in the transition table of §6.2 and the caller must downgrade to ERROR
 * with `code: "invariant_violation"`" (§8.5).
 *
 * The sentinel is a string literal rather than a throw so the controller's
 * dispatcher can log + recover deterministically — the assertion-failure
 * itself never crashes the session (§5.2 invariant 5).
 */
export type TransitionResult = SessionState | "invariant_violation";
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
export declare function transition(state: SessionState, event: SessionEvent, mode: SessionMode): TransitionResult;
/**
 * Construction-time config. The controller is instantiated once per process
 * by the CLI entry point (`use-steady.ts` / `main.ts`) after argv parsing.
 */
export type SessionConfig = {
    readonly mode: SessionMode;
    /** From `--yes`. When true, AWAITING_APPROVAL auto-approves (§9 table). */
    readonly autoYes: boolean;
    /** stdin stream. Defaults to `process.stdin`. Tests inject a Readable. */
    readonly stdin?: NodeJS.ReadableStream;
    /** stdout stream. Defaults to `process.stdout`. Tests inject a Writable. */
    readonly stdout?: NodeJS.WritableStream;
    /** Controls `terminal` in readline.createInterface; defaults to stdin.isTTY. */
    readonly terminal?: boolean;
};
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
export declare class SessionController {
    private _state;
    private readonly mode;
    private readonly autoYes;
    private readonly stdin;
    private readonly stdout;
    private readonly terminal;
    private rl;
    constructor(config: SessionConfig);
    /** Current state. Read-only view. Used by tests and `release:gate`. */
    currentState(): SessionState;
    /** Construction-time mode. Read-only. */
    sessionMode(): SessionMode;
    /** `--yes` flag. Commit 2 uses this to auto-approve AWAITING_APPROVAL. */
    isAutoYes(): boolean;
    /**
     * Apply an event to the current state. Returns the next state. Invariant
     * violations downgrade to ERROR with `code: "invariant_violation"` rather
     * than throwing (§5.2 invariant 5, §8.5).
     *
     * This is the *only* writer of `this._state`.
     */
    dispatch(event: SessionEvent): SessionState;
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
    requestInput(params: {
        readonly purpose: InputPurpose;
        readonly prompt: string;
        readonly until?: "line" | "eof";
    }): Promise<string>;
    /**
     * Release stdin exactly once. Reserved for process exit (§7.4): gates
     * must never call this. Called from the event loop's COMPLETE on-enter
     * effect (wired in commit 2 when the loop lands).
     */
    shutdown(): void;
}
//# sourceMappingURL=controller.d.ts.map