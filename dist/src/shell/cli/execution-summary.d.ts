/**
 * src/shell/cli/execution-summary.ts
 *
 * Stabilization P0 — PR-2 (output-only)
 * -----------------------------------------------------------------------------
 * Builds a deterministic end-of-run execution summary from the task outcomes
 * of a terminal WorkflowRun, and renders the user-facing text block.
 *
 * This module is strictly additive. It does NOT change:
 *   - execution flow
 *   - exit codes
 *   - error codes
 *   - batch behavior (fail-fast lands in PR-3)
 *   - input parsing (PR-4)
 *   - any engine internals
 *
 * It answers one question at end-of-run:
 *
 *   "What actually happened — did every planned step complete, and if not,
 *    which one failed with what code?"
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Counting rules (docs/STABILIZATION_P0.md D3, locked)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  total_steps    = number of planned tasks
 *  executed_steps = number of tasks with outcome === "accepted"
 *  failed_at_step = 1-based index (D1) of the FIRST task with outcome in
 *                   { "stopped", "rejected" }, else null
 *  success        = true iff failed_at_step === null AND
 *                   executed_steps === total_steps
 *  error          = null on success, else the captured errorCode
 *
 *  Worked examples from the locked spec:
 *    - Full success  : all accepted         → executed=total, failed_at=null
 *    - Fails at N    : 1..N-1 accepted, N stopped → executed=N-1, failed_at=N
 *    - Fails at 1    : 1 stopped            → executed=0, failed_at=1
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Naming
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `success` / `error` mirror the public --output json surface which has
 * always used those names (see `emitJsonResult` in use-steady.ts). The
 * internal result-file still carries the legacy `succeeded` / `errorCode`
 * keys for backward-compat; PR-2 only ADDS the three new fields there.
 */
import type { WorkflowTaskOutcome } from "../../workflow/types.js";
export type ExecutionSummary = {
    readonly success: boolean;
    readonly error: string | null;
    readonly failed_at_step: number | null;
    readonly executed_steps: number;
    readonly total_steps: number;
    /**
     * Issue #42 -- count of OCD conflicts the user accepted across the
     * run (sum over all tasks of `conflictsAccepted`). A non-zero value
     * means at least one `WARNING - OCD conflict detected (non-blocking)`
     * frame was answered "yes" (or auto-accepted under `--yes`).
     *
     * Surfaced in the end-of-run summary so the success banner does
     * not silently contradict what the user just witnessed. Independent
     * of `success` -- a run can be both successful AND have accepted
     * warnings; the summary acknowledges both.
     *
     * Defaults to 0 when callers do not supply task-level counters
     * (e.g. legacy code paths that only pass the outcome array). This
     * is a strict superset of the pre-#42 surface.
     */
    readonly warnings_accepted: number;
};
/**
 * Pure function — no side effects, no I/O. Safe to call from anywhere,
 * trivially unit-testable, and the same inputs always produce the same
 * output.
 */
export declare function buildExecutionSummary(params: {
    readonly taskOutcomes: readonly WorkflowTaskOutcome[];
    readonly errorCode: string | null;
    /**
     * Issue #42 -- optional per-task count of accepted OCD conflicts.
     * If supplied, must be the same length as `taskOutcomes`; missing
     * or shorter is treated as zeros (backward-compatible). Aggregated
     * into `summary.warnings_accepted`.
     */
    readonly taskConflictsAccepted?: readonly (number | undefined)[];
}): ExecutionSummary;
/**
 * Render the end-of-run text block. Exactly ONE summary per run (D5).
 *
 * The three locked forms:
 *
 *   SUCCESS (D4):
 *     ✔ Executor reported all tasks accepted.
 *     Steps: X / X
 *
 *   FAILURE (D4) — error classified and a specific step failed:
 *     ✖ Failed: <errorCode>
 *     Failed at step: N
 *     Steps executed: X / Y
 *
 *   NEUTRAL (inferred) — success=false with no classified error and no
 *   failed step. This is the user-cancel path (stopped_by_user from
 *   PR-1): the run did not complete, but nothing failed. Rendering
 *   "✖ Failed: unknown" here would undo PR-1's truthful-failure fix, so
 *   we print a neutral marker. The JSON shape is unchanged (the
 *   NEUTRAL case is just {success:false, error:null, failed_at_step:null,
 *   executed_steps:X, total_steps:Y}).
 *
 * Indentation (two leading spaces) matches the existing CLI frame style.
 * The glyphs ✔ and ✖ are rendered as ASCII "ok" / "x" by the shared
 * sanitizeForConsole helper; see main.ts.
 */
export declare function renderExecutionSummaryLines(summary: ExecutionSummary): readonly string[];
//# sourceMappingURL=execution-summary.d.ts.map