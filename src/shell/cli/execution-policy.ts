/**
 * src/shell/cli/execution-policy.ts
 *
 * Stabilization P0 — PR-3 (batch fail-fast)
 * -----------------------------------------------------------------------------
 * Internal execution policy for the workflow loop. This module is a *policy
 * carrier only* — no execution behavior lives here. The loop (runWorkflowLoop)
 * reads the policy and decides whether to suppress skip/retry choices and
 * hard-stop on silent-skip outcomes.
 *
 * Two policies:
 *
 *   "interactive"       — current behavior. Task failures surface the
 *                         stop/skip/retry choose prompt. Multi-step specs
 *                         from --prompt, NL single-strings, interactive
 *                         spec builders, and single-op --json all use
 *                         this policy. Individual choices may still be
 *                         auto-answered under --yes.
 *
 *   "batch_fail_fast"   — PR-3 behavior for declared batch surfaces.
 *                         Set for:
 *                            - `--batch <file>` (surface === "batch")
 *                            - `--json '<array>'` (surface === "json" AND
 *                              parsed input is an Array)
 *                         Guarantees:
 *                            - First failure stops execution. No later
 *                              ops run.
 *                            - No skip/retry UX is rendered.
 *                            - Silent continuation via skipped_by_intake
 *                              / skipped / rejected outcomes is caught
 *                              at the loop guard and promoted to a
 *                              hard stop (defensive for NL-input specs).
 *
 * Scope (locked, see docs/STABILIZATION_P0.md):
 *   - PR-3 does NOT change error codes (PR-1 locked them).
 *   - PR-3 does NOT change the summary shape (PR-2 locked it).
 *   - PR-3 does NOT refactor the workflow engine or coordinator.
 *   - PR-3 does NOT change interactive UX.
 *   - PR-3 applies to batch surfaces only (D1).
 */

export type ExecutionPolicy = "interactive" | "batch_fail_fast";

/**
 * Env var that carries the policy across the use-steady.ts → main.ts
 * import boundary. use-steady.ts sets this BEFORE `await import("./main.js")`
 * for batch surfaces; main.ts reads it when constructing the runWorkflowLoop
 * call. Default (unset / any non-"true" value) is "interactive".
 */
export const BATCH_FAIL_FAST_ENV = "USESTEADY_BATCH_FAIL_FAST";

/** Resolve the policy from the environment. Default = "interactive". */
export function resolveExecutionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): ExecutionPolicy {
  return env[BATCH_FAIL_FAST_ENV] === "true"
    ? "batch_fail_fast"
    : "interactive";
}

/**
 * Decide whether a given (surface, parsedInput) pair constitutes a batch
 * surface for fail-fast purposes. Pure function — safe to test in
 * isolation. Rule (D1):
 *
 *   - surface === "batch"                           → batch_fail_fast
 *   - surface === "json" AND Array.isArray(parsed)  → batch_fail_fast
 *   - anything else                                 → interactive
 *
 * A single-object --json payload is NOT batch — per D1, "batch" is the
 * array/file surface, not every JSON invocation.
 */
export function shouldBatchFailFast(params: {
  readonly surface: "json" | "batch";
  readonly parsed:  unknown;
}): boolean {
  if (params.surface === "batch") return true;
  if (params.surface === "json" && Array.isArray(params.parsed)) return true;
  return false;
}
