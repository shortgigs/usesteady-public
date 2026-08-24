/**
 * src/input/feasibility-validator.ts
 *
 * M3 — `FeasibilityValidator`. The first runtime consumer of the IR.
 *
 * Per design §3.3 + §6.5 (`docs/CLI_INPUT_NORMALIZATION_DESIGN.md` v2.2),
 * the validator is a single pre-flight pass that runs path-level checks
 * against the current filesystem state before execution. It hoists a
 * subset of checks out of the executor without removing the executor's
 * defense-in-depth guards.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M3 scope (load-bearing — see design §6.5)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * What this validator owns (path-level, NO file-content reads):
 *
 *   - `create` (`write_file`) target already exists       → `target_exists`
 *   - `rename` destination already exists                 → `target_exists`
 *   - `delete` target missing                             → `file_not_found`
 *     (deliberate public-surface refinement per §6.5.2 — was `execution_error`)
 *   - Symlink path-level refusal on `write_file`/`rename` → `merge_conflict`
 *     (additive only — same code surfaced earlier; executor guard stays)
 *
 * What stays at execute time (content-dependent or race-window):
 *
 *   - `replace` target file missing      → `file_not_found`      (executor reads file anyway)
 *   - `replace` `from` not present       → `old_value_not_found` (content-dependent)
 *   - `replace` `from` matches multiple  → `ambiguous_match`     (content-dependent)
 *   - Binary file (NUL byte) detection   → `merge_conflict`      (requires reading bytes)
 *   - `run_command` exit code, stdout/stderr (intrinsically execute-time)
 *
 * Post-M3 widening (usesteady-public#45 — occurrence-directive truthfulness):
 *
 *   - `replace` with explicit non-"first" `requestedOccurrence`
 *                                        → `ambiguous_match`     (validate-stage)
 *     The IR carries `requestedOccurrence` only when the user *explicitly*
 *     specified an occurrence directive (NL always; JSON only when the
 *     `occurrence` field is present in the public op). The executor does
 *     not honor occurrence selection today: the replace path picks the
 *     first match and refuses with `ambiguous_match` when more than one
 *     exists, regardless of what the user asked for. Pre-#45, "all" and
 *     "Nth" directives on the NL surface were either dropped silently or
 *     refused at spec-load with a message pointing the user to
 *     `--json` / `batch` (which also drops the field). Pre-#45 on the
 *     JSON surface, the `occurrence` field was advertised by
 *     `usesteady capabilities` but silently stripped at parse.
 *
 *     The validator now refuses at validate-stage when the user's
 *     explicit directive is "all" or `{ index: N }`, with a diagnostic
 *     that quotes the directive verbatim. The "first" case still flows
 *     through to the executor unchanged (preserves today's accidental-
 *     success path for 1-match files; the executor still refuses on
 *     >1-match content as before). Same public `ambiguous_match` code
 *     as the executor refusal — §6.5.1 rule 3 / §6.6.1 rule 7.
 *
 * Hard rules:
 *
 *   1. The validator MUST NOT open files. It runs only on IR + path-level
 *      `fs` stat (`existsSync`, `lstatSync`). Anything that requires
 *      `readFileSync`/`readFile` is execute-time. (§6.5.1 rule 1.)
 *
 *   2. The validator does NOT replace the executor's guards. The executor
 *      keeps every existing pre-execution check as TOCTOU defense-in-depth.
 *      (§6.5.1 rule 2.)
 *
 *   3. Validator-stage and execute-stage error codes are identical for
 *      the same root cause. (§6.5.1 rule 3.)
 *
 *   4. `append`/`prepend` deliberately have NO missing-target check at
 *      either stage — their existing semantics are *create-if-missing*
 *      (matching POSIX `>>`). The validator never refuses these ops on
 *      missing target.
 *
 *   5. Symlink/binary errorCode harmonization across all fs ops is OUT OF
 *      SCOPE for M3. M3 mirrors the existing inconsistency (validator
 *      emits `merge_conflict` for symlink only on `write_file`/`rename`,
 *      matching the executor's existing behavior). Tracked as #224 / #225
 *      post-M3 follow-ups.
 *
 * Post-M3 widening (S1 / friction #26):
 *
 *   - `invalid_path` — byte-level path check on every path-bearing op,
 *     run BEFORE any `existsSync` / `lstatSync` probe. Refused at the
 *     validate stage when any path field contains a null byte (0x00).
 *     This is the first new validator-emitted code added after M3 ship;
 *     it follows the same hard rules above (no file reads, no stdin,
 *     no NL handling) and is documented in the public Adapter-layer
 *     enum in `src/shell/cli/use-steady.ts`. The change is purely
 *     additive — no existing op or code is rerouted.
 *
 * What this file does NOT do:
 *   - It does not own stdin (M5 / SessionController).
 *   - It does not normalize NL (M4).
 *   - It does not read file contents.
 */
import type { IR, Operation } from "./ir.js";
import type { ValidateError } from "./cli-error.js";
/**
 * Context the validator needs to resolve relative paths and probe the
 * filesystem. Passed in explicitly so call sites are honest about which
 * filesystem the validator is checking against, and so tests can supply
 * an isolated workspace root.
 *
 * `fs` is injectable for unit tests that do not want to touch the real
 * filesystem. Default is `node:fs` (`existsSync`, `lstatSync`).
 */
export type ValidatorContext = {
    readonly workspaceRoot: string;
    readonly fs?: ValidatorFs;
};
/**
 * Minimal filesystem surface the validator depends on. Both methods are
 * synchronous because path-level stat is fast and the validator runs once
 * per IR — the M2 JSON pipeline is already synchronous on the hot path.
 *
 * `existsSync(path)`: true if a filesystem entry exists at `path`.
 * `isSymlink(path)`: true if `path` is a symbolic link (NOT followed).
 */
export type ValidatorFs = {
    readonly existsSync: (path: string) => boolean;
    readonly isSymlink: (path: string) => boolean;
};
declare function pathEscapesWorkspace(p: string): boolean;
declare const OUTSIDE_WORKSPACE_MSG = "Path is outside the workspace. Use a relative path inside the current workspace.";
export { pathEscapesWorkspace, OUTSIDE_WORKSPACE_MSG };
/**
 * Validate a single IR `Operation` against the current filesystem state.
 *
 * Returns `null` if the op is feasible at the validate stage, or a
 * `ValidateError` (without `index` — caller fills it in if walking an IR)
 * if the op should be refused before execution.
 *
 * The returned error's `code` is one of `target_exists`, `file_not_found`,
 * `merge_conflict` (M3 validator-emitted subset), or `invalid_path` (S1 /
 * #26 widening — null byte in any path-bearing field). All are documented
 * in `cli-error.ts`.
 */
export declare function validateOperation(op: Operation, context: ValidatorContext): Omit<ValidateError, "index"> | null;
/**
 * Walk an IR's operations and return the first `ValidateError`, or `null`
 * if every op passes. Per design §6.4 ("if a stage returns a structured
 * error, the next stage is never invoked"), the walker stops at the first
 * failure.
 *
 * Multi-op semantics: this function does NOT model the side effects of
 * earlier ops in the same IR. It checks every op against the current
 * filesystem state. Intra-IR conflicts (e.g. `[create foo, rename bar to foo]`
 * where neither op is infeasible at start) are caught by the executor's
 * defense-in-depth at execute time — not here. The validator's job is
 * pre-flight, not simulation.
 *
 * The behavior change for multi-op IRs where an op[i] fails validation:
 * before M3, ops [0..i-1] would execute and op[i] would fail at the
 * executor; after M3, no ops execute. This is more atomic and is acceptable
 * because no existing test pinned the partial-execution behavior. See the
 * M3 PR description and design §6.5 for the analysis.
 */
export declare function validateIR(ir: IR, context: ValidatorContext): ValidateError | null;
//# sourceMappingURL=feasibility-validator.d.ts.map