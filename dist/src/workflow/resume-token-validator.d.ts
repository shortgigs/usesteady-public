/**
 * src/workflow/resume-token-validator.ts
 *
 * P2-min — Token-vs-spec/workspace validation.
 *
 * Given a structurally-valid token (from `readResumeToken`) and the
 * current spec + workspace root, decide whether the token is bound to
 * exactly the same workflow run identity.
 *
 * This is the "gate before per-task verification" step. If the gate
 * fails, the resume path stops here with a closed-set error code; the
 * per-task verifier never runs.
 *
 * Authority discipline:
 *   - This module's only output is a `ResumeTokenValidationResult`
 *     discriminant. It performs no I/O beyond reading the file when
 *     `validateTokenForResume` is asked to load + validate in one
 *     call.
 *   - No new error codes minted — the closed set lives in
 *     `resume-token-types.ts` as `ResumeTokenRejectionCode`.
 */
import type { WorkflowSpec } from "./types.js";
import { type ResumeTokenV1, type ResumeTokenValidationResult } from "./resume-token-types.js";
/**
 * Validate a parsed token against the current spec + workspace root.
 *
 * Order of checks (each short-circuits on failure):
 *   1. Spec hash match.
 *   2. Total task count match.
 *   3. completed_task_count is in [0, total_task_count].
 *   4. Per-task op_type signature match for `[0, completed_task_count)`.
 *   5. Workspace root match (resolved/normalized).
 *
 * Step 6 is a special-case: `completed_task_count === total_task_count`
 * yields `workflow_already_complete`. Friendly exit; not an error.
 */
export declare function validateTokenAgainstSpec(token: ResumeTokenV1, spec: WorkflowSpec, workspaceRoot: string): ResumeTokenValidationResult;
/**
 * Convenience: read + parse + validate in one call. Returns the same
 * discriminant as `validateTokenAgainstSpec`, plus the read-stage
 * failure codes mapped to canonical token-rejection codes:
 *
 *   missing            → invalid_resume_token
 *   invalid (parse)    → invalid_resume_token
 *   unsupported_format → invalid_resume_token_format
 */
export declare function validateTokenForResume(tokenPath: string, spec: WorkflowSpec, workspaceRoot: string): ResumeTokenValidationResult;
//# sourceMappingURL=resume-token-validator.d.ts.map