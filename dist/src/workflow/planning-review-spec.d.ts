/**
 * Runtime planning-review spec builder.
 * USESTEADY_RUNTIME_PLANNING_REVIEW_ROUTING_V1
 * USESTEADY_WORKPLAN_GENERATION_V1 — template-driven WorkPlan transform.
 *
 * Pure mapping: ConfirmedUnderstandingV1 -> WorkflowSpec with planningReview tasks.
 * No intake, no execute, no Portal review-draft builder import.
 */
import type { ConfirmedUnderstandingV1 } from "../portal-bridge/confirmed-understanding-handoff.js";
import type { WorkflowSpec } from "./types.js";
/** True when the spec is a Runtime planning-review run (non-execution). */
export declare function isPlanningReviewSpec(spec: WorkflowSpec): boolean;
/**
 * Build a fresh WorkflowSpec for planning review from confirmed understanding.
 * Caller must pass the result to createWorkflowRun (spec hash locks at creation).
 */
export declare function buildPlanningReviewSpecFromConfirmed(confirmed: ConfirmedUnderstandingV1): WorkflowSpec;
/** Exposed for certification — generate WorkPlan without full spec. */
export { generateWorkPlanFromConfirmed } from "./work-plan-generator.js";
//# sourceMappingURL=planning-review-spec.d.ts.map