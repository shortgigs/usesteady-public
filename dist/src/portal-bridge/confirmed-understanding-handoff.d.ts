/**
 * Intent → Decomposition handoff v1.
 * USESTEADY_INTENT_TO_DECOMPOSITION_HANDOFF_V1
 *
 * When the user has confirmed understanding, the review-draft planner MUST use
 * those bullets — not the unconfirmed intake path-decomposition scaffold.
 */
import type { ContextEnvelopeV1 } from "./context-envelope-v1.js";
import type { PortalUnderstandWorkflowResult } from "./types.js";
/**
 * Ratified goal carry — USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1 (S2).
 *
 * The one goal span the human ratified during reflection (charter §1: the
 * IsolatedIntent candidate promoted by the explicit human yes). Additive and
 * optional: absent → the planner keeps today's blob behavior byte-identical
 * (INV-GI-4). Offsets index into the parsed (trimmed) rawInput and are always
 * recomputed locally at parse time — never trusted from the wire (INV-GI-7).
 */
export type RatifiedGoalV1 = {
    readonly text: string;
    readonly start: number;
    readonly end: number;
};
export type ConfirmedUnderstandingV1 = {
    readonly format: "usesteady.confirmed-understanding.v1";
    readonly bullets: readonly string[];
    readonly rawInput: string;
    readonly confirmedAt: string;
    /** Present only when a human ratified an isolated goal (charter INV-GI-6). */
    readonly ratifiedGoal?: RatifiedGoalV1;
};
/**
 * Validate a wire ratifiedGoal against the parsed rawInput. Fail-closed to
 * legacy (INV-GI-4): anything not a verbatim substring of rawInput — invented
 * text, stale offsets pointing at revised input, over-length goals — returns
 * null and the field is simply omitted. Claimed offsets are used only as a
 * disambiguation hint when they slice correctly; otherwise the first verbatim
 * occurrence wins. The returned offsets are always locally derived.
 */
export declare function parseRatifiedGoalV1(raw: unknown, rawInput: string): RatifiedGoalV1 | null;
export declare function parseConfirmedUnderstandingV1(raw: unknown): ConfirmedUnderstandingV1 | null;
/** Returns true when text must not appear in a handoff review draft. */
export declare function isForbiddenHandoffPhrase(text: string): boolean;
/**
 * Build review draft from user-confirmed understanding.
 * Skips intake path-decomposition when understanding is already confirmed.
 */
export declare function buildReviewDraftFromConfirmedUnderstanding(intent: string, confirmed: ConfirmedUnderstandingV1, context: ContextEnvelopeV1): PortalUnderstandWorkflowResult;
//# sourceMappingURL=confirmed-understanding-handoff.d.ts.map