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
import type { IdempotencyClass } from "./resume-verifier-types.js";
/**
 * Canonical format discriminator for the v1 resume token. Any reader
 * MUST reject tokens whose `format` does not exactly match this string.
 * Future versions (v2+) will have their own discriminant and are NOT
 * silently up-converted from v1.
 */
export declare const RESUME_TOKEN_FORMAT_V1: "usesteady.resume-token.v1";
export type ResumeTokenFormatV1 = typeof RESUME_TOKEN_FORMAT_V1;
/**
 * Summary of one completed task as captured in the token at issue time.
 *
 *   - `index`    is the task's position in the spec's `tasks` array.
 *   - `label`    is cosmetic; never used for matching.
 *   - `op_type`  is matched against the current spec's task at the
 *                same index during resume; mismatch ⇒ `task_signature_mismatch`.
 *   - `idempotency_class` is used by the resume verifier to decide
 *                whether the task can be silently classified as
 *                `already_done` (checkable) or must re-prompt the
 *                operator (`requires_reconfirm` / `interpretive`).
 *                A `skipped` task remains skipped on resume.
 */
export type CompletedTaskSummary = {
    readonly index: number;
    readonly label: string;
    readonly op_type: string;
    readonly idempotency_class: IdempotencyClass;
};
/**
 * The on-disk shape of a v1 resume token.
 *
 * All fields are required. Token readers reject any token missing a
 * field or carrying a field of the wrong type.
 *
 * See `docs/product/p2-min-resume-token-design-v1.md` §2 for the
 * field-by-field trust property table.
 */
export type ResumeTokenV1 = {
    readonly format: ResumeTokenFormatV1;
    readonly workflow_run_id: string;
    readonly workflow_name: string;
    readonly workflow_spec_hash: string;
    readonly spec_path: string;
    readonly workspace_root: string;
    readonly completed_task_count: number;
    readonly total_task_count: number;
    readonly completed_task_summaries: readonly CompletedTaskSummary[];
    readonly issued_at: string;
    readonly issued_by: string;
    readonly token_id: string;
};
/**
 * Closed set of reasons the resume path may reject a token. Each maps
 * to operator-readable messaging. The set is intentionally narrow:
 * resume either runs (token accepted) or refuses (token rejected,
 * exit 2). There is no "warn and continue" mode.
 *
 * Codes:
 *   - invalid_resume_token_format
 *       The file's `format` field is missing, wrong type, or not equal
 *       to RESUME_TOKEN_FORMAT_V1. Includes the unsupported-future-version
 *       case (v2 file fed to v1 reader).
 *
 *   - invalid_resume_token
 *       The JSON is malformed, the file is missing, or a structural
 *       field is the wrong shape (e.g. completed_task_count is a string).
 *
 *   - spec_hash_mismatch
 *       The token's `workflow_spec_hash` does not equal the canonical
 *       hash of the current spec. The spec was edited; resume refuses.
 *
 *   - task_count_mismatch
 *       Belt-and-braces: the spec's task array length does not equal
 *       the token's `total_task_count`. (Subsumed by spec_hash_mismatch
 *       in practice but checked explicitly for a clearer error.)
 *
 *   - task_signature_mismatch
 *       At some index `k < completed_task_count`, the current spec's
 *       task `op_type` does not match the token's recorded `op_type`.
 *
 *   - workspace_root_mismatch
 *       The resolved `--workspace-root` does not equal the token's
 *       recorded `workspace_root`.
 *
 *   - corrupt_resume_token
 *       Structural impossibility — e.g. completed_task_count exceeds
 *       total_task_count, or task_index out of order.
 *
 *   - workflow_already_complete
 *       Special case: `completed_task_count === total_task_count`.
 *       Not strictly an error — resume prints a friendly message and
 *       exits 0. Kept in this enum so the dispatcher can switch on it
 *       uniformly with the other classifications.
 */
export type ResumeTokenRejectionCode = "invalid_resume_token_format" | "invalid_resume_token" | "spec_hash_mismatch" | "task_count_mismatch" | "task_signature_mismatch" | "workspace_root_mismatch" | "corrupt_resume_token" | "workflow_already_complete";
export type ResumeTokenValidationResult = {
    readonly ok: true;
    readonly token: ResumeTokenV1;
} | {
    readonly ok: false;
    readonly code: ResumeTokenRejectionCode;
    readonly message: string;
};
//# sourceMappingURL=resume-token-types.d.ts.map