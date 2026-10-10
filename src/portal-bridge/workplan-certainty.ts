/**
 * USESTEADY_CORE_WORKPLAN_CERTAINTY_VOCABULARY_V1
 *
 * Single source of truth for the certainty a generated WorkPlan response carries
 * across the Core -> Ops portal boundary.
 *
 * The legacy intake handoff (`buildReviewDraftFromConfirmedUnderstanding`) stamps
 * `certaintyLevel: "confirmed"`. That value is a write-only outlier: nothing in
 * Core reads it, and it sits OUTSIDE Core's canonical certainty vocabulary
 * (`certain | inferred | unknown`). The Ops Reality/Workflow seam maps any
 * unrecognized word to "unknown", which routes a plan-ready WorkPlan to a
 * "report" instead of a "plan" -- suppressing the plan branch (and with it the
 * WHY PRESENT attribution line).
 *
 * Reaching the WorkPlan response boundary means `generateWorkPlanFromConfirmed`
 * did NOT decline -- i.e. the plan IS plan-ready. So at that boundary we emit a
 * canonical, plan-gate-compatible certainty. We choose "inferred" rather than
 * "certain" because WorkPlan steps are derived expansions of the goal, not
 * literal user statements: "review each step" is the honest band.
 *
 * Scope guardrails (this lane only):
 *   - Core side only. No Ops seam change. No RWS change.
 *   - No `present_facts` change. No approval-behavior change.
 *   - The legacy "confirmed" word is NOT globally renamed: a declined plan still
 *     falls through and keeps its existing unknown/incomplete shape. Only the
 *     successful WorkPlan response boundary is realigned.
 */

/** Canonical Core certainty vocabulary (mirror of present/types.ts + ucp/projection.ts). */
export type CanonicalCertaintyLevel = "certain" | "inferred" | "unknown";

/** Certainty a successfully generated, plan-ready WorkPlan response emits. */
export const WORKPLAN_PLAN_READY_CERTAINTY: CanonicalCertaintyLevel = "inferred";

export type WorkPlanPresentation = {
  readonly mode: string;
  readonly certaintyLevel: CanonicalCertaintyLevel;
};

/**
 * Presentation block for a plan-ready WorkPlan response. `mode` is preserved from
 * the upstream result when present (defaults to "guide"); `certaintyLevel` is
 * always realigned to the canonical, plan-gate-compatible value.
 */
export function workPlanPresentation(mode?: string): WorkPlanPresentation {
  return {
    mode: mode ?? "guide",
    certaintyLevel: WORKPLAN_PLAN_READY_CERTAINTY,
  };
}
