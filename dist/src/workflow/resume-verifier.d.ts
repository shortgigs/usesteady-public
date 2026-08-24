/**
 * src/workflow/resume-verifier.ts
 *
 * P2-min — Per-task resume verification.
 *
 * Given a validated token and the current spec + workspace, classify
 * each `0..K-1` task into one of the `TaskVerificationVerdict`s. The
 * coordinator then decides what to do per-task:
 *
 *   already_done           → silent skip
 *   previously_skipped     → silent skip
 *   requires_reconfirm     → re-prompt operator (default: abort)
 *   interpretive_reconfirm → re-prompt operator (default: abort)
 *   task_state_diverged    → refuse resume; operator must reconcile
 *
 * Authority discipline:
 *
 *   - The verifier is READ-ONLY w.r.t. the workspace. It uses
 *     `existsSync` and `statSync` only; it never writes, deletes, or
 *     renames anything.
 *   - Approval is not encoded here. The verifier classifies; the
 *     coordinator + operator make the runtime decision.
 *   - Idempotency-class assignment matches the closed set in
 *     `resume-verifier-types.ts`. The set is intentionally narrow:
 *     v1 marks only the structurally-checkable ops (create, delete,
 *     rename, create_dir) as `checkable`. Content-bearing ops
 *     (replace, append, prepend) and side-effecting ops (run) are
 *     `requires_reconfirm` until a follow-up primitive broadens
 *     the checkable set with content hashing.
 */
import type { WorkflowSpec, WorkflowTaskSpec } from "./types.js";
import { type IdempotencyClass, type ResumeVerificationReport } from "./resume-verifier-types.js";
import type { ResumeTokenV1 } from "./resume-token-types.js";
/**
 * Closed map of operationType → idempotency class. The verifier's
 * v1 checkable set is intentionally narrow — only ops whose
 * post-state is "presence/absence of a path" qualify. Broader content
 * hashing is left to a follow-up primitive.
 *
 * `claude` runtime is handled separately (see `classifyTask`).
 */
declare function classifyOpType(opType: string): IdempotencyClass;
/**
 * Run resume verification across the `[0, completed_task_count)`
 * range. Pure inspection — no writes. Each task is classified
 * independently; the aggregate gate combines them per the rule:
 *
 *   any diverged                 → aggregate = "diverged"
 *   else any requires_reconfirm  → aggregate = "needs_reconfirm"
 *   else                          → aggregate = "clean"
 *
 * `previously_skipped` is informational only — does not affect the
 * aggregate.
 */
export declare function verifyResumePoint(token: ResumeTokenV1, spec: WorkflowSpec, workspaceRoot: string): ResumeVerificationReport;
export { classifyOpType };
/**
 * Shared helper: derive the canonical op_type string for a
 * `WorkflowTaskSpec`. Used by:
 *   - the token writer (when recording a completed task)
 *   - the validator (when comparing token vs current spec)
 *   - the verifier (when classifying idempotency)
 *
 * Single source of truth keeps the three call sites synchronized; if
 * the WorkflowTaskSpec discriminant ever changes, this function changes
 * once.
 */
export declare function opTypeForTask(task: WorkflowTaskSpec): string;
/**
 * Shared helper: derive the canonical idempotency class for a task.
 * Wraps `classifyTask` to expose only the class (useful when recording
 * a completed task summary).
 */
export declare function idempotencyClassForTask(task: WorkflowTaskSpec): IdempotencyClass;
//# sourceMappingURL=resume-verifier.d.ts.map