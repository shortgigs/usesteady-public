/**
 * Response Planner — maps IntentStates to ResponseModes.
 *
 * This is the final authority on what action the system takes.
 * It is deterministic, explicit, and documented per case.
 *
 * Hard rule: ResponseMode "execute" is ONLY returned for IntentState "clear".
 * No other path reaches execution.
 *
 * Mapping:
 *   unsafe          → refuse   (blocked; explain refusal)
 *   non_literal     → ignore   (social input; no task processing)
 *   ambiguous       → clarify  (ask for disambiguation)
 *   incomplete      → guide    (reserved alias; not used directly by classifier)
 *   guided_recovery → guide    (provide next steps)
 *   clear           → execute  (deterministic, actionable)
 */
import type { IntentState, ResponseMode } from "./types.js";
type PlannerDecision = {
    readonly mode: ResponseMode;
    readonly reason: string;
};
export declare function planResponse(state: IntentState): PlannerDecision;
export {};
//# sourceMappingURL=response-planner.d.ts.map