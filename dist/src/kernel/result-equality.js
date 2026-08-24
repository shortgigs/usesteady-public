/**
 * Kernel v1 / K4 — KernelResult equality.
 *
 * ── Scope (PR-K4 design lock §9) ─────────────────────────────────────────────
 *
 *   Pure function. Field-by-field strict equality. No tolerance, no
 *   normalization beyond what K2 already applied at finalize time.
 *
 *   `error` is a canonical-or-null string (K2 contract — see
 *   src/kernel/error-codes.ts) so `===` is the correct comparison.
 *   `failed_at_step` is `number | null`; both arms compare with `===`.
 *
 *   Used by `runExecutionReplay` to compute `result_match: boolean` between
 *   the artifact's stored `result` and the freshly-built KernelResult from
 *   the sandbox run.
 */
export function kernelResultsEqual(a, b) {
    return (a.success === b.success
        && a.error === b.error
        && a.executed_steps === b.executed_steps
        && a.failed_at_step === b.failed_at_step
        && a.total_steps === b.total_steps);
}
//# sourceMappingURL=result-equality.js.map