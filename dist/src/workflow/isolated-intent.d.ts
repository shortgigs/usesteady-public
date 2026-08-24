/**
 * Goal isolation boundary — USESTEADY_WORKPLAN_ASK_SPAN_EXTRACTION_IMPL_V1
 *
 * Locates the operative ask span (imperative / labelled directive) and fences
 * status, evidence, history, quoted examples, and manifests. Fail-closed when
 * no ask span exists — never falls back to the residual blob.
 */
import type { ConfirmedUnderstandingV1 } from "../portal-bridge/confirmed-understanding-handoff.js";
import type { WorkPlanSourceRef } from "./work-plan-types.js";
export type NonGoalSegmentKind = "evidence" | "example" | "constraint" | "context" | "instruction";
export type NonGoalSegment = {
    readonly kind: NonGoalSegmentKind;
    readonly text: string;
    readonly sourceRef: WorkPlanSourceRef["ref"];
    readonly start: number;
    readonly end: number;
};
export type IsolatedIntent = {
    readonly format: "usesteady.isolated-intent.v1";
    readonly goalText: string;
    readonly goalSourceRef: WorkPlanSourceRef;
    readonly nonGoalSegments: readonly NonGoalSegment[];
    readonly isolationHash: string;
};
export declare class GoalIsolationDeclinedError extends Error {
    readonly code: "goal_isolation_declined";
    readonly reason: string;
    constructor(reason: string);
}
export declare function isGoalIsolationDeclinedError(err: unknown): err is GoalIsolationDeclinedError;
/**
 * Isolate operative ask text from confirmed understanding.
 * Bullets never contribute to goalText — they are non-goal traceability only.
 */
export declare function isolateIntentFromConfirmed(confirmed: ConfirmedUnderstandingV1): IsolatedIntent;
/**
 * Ratified-goal isolation — USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1 (S2).
 *
 * When a human has ratified an isolated goal (charter §1: the model-proposed
 * IsolatedIntent candidate promoted by the explicit human yes), the ratified
 * span IS the goal — no ask-span heuristics run. This function is pure and
 * model-free (INV-GI-1): the ratified goal arrives as frozen text, so identical
 * ratified input → identical isolation → byte-identical plan.
 *
 * The remainder of the raw input is classified into non-goal segments with the
 * SAME deterministic block classifiers as the legacy path, so provenance and
 * display coverage survive (report §7.2 total-coverage) — but per INV-GI-2 the
 * caller reads ONLY goalText for classification, normalization, and planning.
 *
 * Fail-closed to legacy (INV-GI-4): a ratified goal that does not verify as a
 * verbatim substring of rawInput at its offsets throws — the generator catches
 * nothing here; verification happens at parse time (parseRatifiedGoalV1), so a
 * mismatch reaching this function is a programming error, not user input.
 */
export declare function isolateIntentFromRatifiedGoal(confirmed: ConfirmedUnderstandingV1): IsolatedIntent;
/** GI-5 / AS-5: identical input → identical isolationHash across runs. */
export declare function assertIsolationDeterminism(confirmed: ConfirmedUnderstandingV1, runs?: number): boolean;
//# sourceMappingURL=isolated-intent.d.ts.map