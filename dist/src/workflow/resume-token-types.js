/**
 * src/workflow/resume-token-types.ts
 *
 * P2-min — Resume Token type definitions.
 *
 * The resume token is a small, content-addressed JSON file written after
 * each successfully-delivered task. It carries enough identity to bind
 * itself to a specific spec + workspace, and a `completed_task_count`
 * field that the resume path uses to skip re-execution of tasks the
 * validator can verify are already-done.
 *
 * Design lock: `docs/product/p2-min-resume-token-design-v1.md`.
 *
 * Authority discipline (load-bearing):
 *
 *   - The token carries ZERO approval state. Approval is a runtime
 *     decision; the token cannot encode it.
 *   - The token is not authority. A tampered token can at worst cause
 *     extra verification work; it cannot cause silent re-execution
 *     because the validator re-checks every "already-done" claim
 *     against current disk state.
 *   - No new error codes are minted at the kernel level. The token
 *     layer has its own narrow code set (`ResumeTokenRejectionCode`)
 *     used only at resume time.
 *
 * No I/O in this module — pure types.
 */
// ─── Token format ───────────────────────────────────────────────────────────
/**
 * Canonical format discriminator for the v1 resume token. Any reader
 * MUST reject tokens whose `format` does not exactly match this string.
 * Future versions (v2+) will have their own discriminant and are NOT
 * silently up-converted from v1.
 */
export const RESUME_TOKEN_FORMAT_V1 = "usesteady.resume-token.v1";
//# sourceMappingURL=resume-token-types.js.map