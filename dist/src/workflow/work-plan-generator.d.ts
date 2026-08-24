/**
 * Deterministic WorkPlan generator — USESTEADY_WORKPLAN_GENERATION_V1
 *
 * Template selection + contract grounding. Fail-closed. No LLM sampling.
 */
import type { ConfirmedUnderstandingV1 } from "../portal-bridge/confirmed-understanding-handoff.js";
import type { DeliverableType, WorkPlan, WorkPlanSourceRef, WorkPlanTask } from "./work-plan-types.js";
type DeliverableClassification = {
    readonly type: DeliverableType;
    readonly sourceSpan: WorkPlanSourceRef;
};
declare function classifyDeliverableFromGoal(goalText: string, goalSourceRef: WorkPlanSourceRef): DeliverableClassification;
export type NormalizedSubject = {
    readonly subject: string;
    readonly leadVerb: string | null;
    readonly defaulted: boolean;
};
/**
 * Verb-agnostic subject normalization — USESTEADY_WORKPLAN_SUBJECT_NORMALIZATION_V1.
 * Pure function: identical input → identical { subject, leadVerb, defaulted }.
 *
 * Business intent extensions:
 *
 * V1 (USESTEADY_BUSINESS_INTENT_EXTRACTION_IMPL_V1):
 * Requester frames stripped; purpose complement preserved.
 *
 * V2 (USESTEADY_BUSINESS_INTENT_EXTRACTION_IMPL_V2):
 * - BIC-1: "It would help/be great if X could/got Y" stripped and reshaped
 *   into "a system for X to Y" (capability) or "Y for X" (deliverable-got).
 *   Outcome-only conditionals ("churn was lower") are NOT matched — no "could/got".
 * - BIC-6 (infinitive complement): "to VERB ..." after frame strip →
 *   "a system to VERB ..." to avoid malformed "Create to know ..." goals.
 * - BIC-6 (role noun): "Our agents need X" → subject becomes "X for agents"
 *   so beneficiary survives into the goal. Generic nouns (team, company) excluded.
 * - BIC-6 (bare proper-noun): "Sales needs X" → frame stripped like V1.
 * - BIC-7: "Set up" as phrasal verb preserved intact; purpose clause retained.
 *
 * All detection is structural only — no keyword lists.
 */
export declare function normalizeSubject(rawInput: string): NormalizedSubject;
declare function extractSubject(rawInput: string): string;
declare function computePlanHash(deliverableType: string, goal: string, tasks: readonly WorkPlanTask[], nextAction: string): string;
/**
 * Generate a deterministic WorkPlan from confirmed understanding.
 * Every task is template-derived with a resolvable sourceSpan.
 */
export declare function generateWorkPlanFromConfirmed(confirmed: ConfirmedUnderstandingV1): WorkPlan;
/** T6: structural hash equality across runs. */
export declare function assertPlanDeterminism(confirmed: ConfirmedUnderstandingV1, runs?: number): boolean;
/** T3: verify template registry contains no forbidden PM actions. */
export declare function assertTemplatesForbiddenClean(): boolean;
export { classifyDeliverableFromGoal as classifyDeliverable, computePlanHash, extractSubject };
export { isolateIntentFromConfirmed, isolateIntentFromRatifiedGoal, isGoalIsolationDeclinedError, GoalIsolationDeclinedError, } from "./isolated-intent.js";
export type { IsolatedIntent, NonGoalSegment } from "./isolated-intent.js";
//# sourceMappingURL=work-plan-generator.d.ts.map