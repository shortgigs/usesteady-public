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

export function planResponse(state: IntentState): PlannerDecision {
  switch (state) {
    case "unsafe":
      return {
        mode: "refuse",
        reason: "Input matched a safety pattern and cannot be processed.",
      };

    case "non_literal":
      return {
        mode: "ignore",
        reason: "Input is conversational and does not represent a task request.",
      };

    case "ambiguous":
      return {
        mode: "clarify",
        reason: "Input has multiple possible interpretations. Clarification is required.",
      };

    case "incomplete":
      return {
        mode: "guide",
        reason: "Input is safe but underspecified. Guidance provided.",
      };

    case "guided_recovery":
      return {
        mode: "guide",
        reason:
          "Input does not match a supported deterministic format. Next steps provided.",
      };

    case "clear":
      return {
        mode: "execute",
        reason: "Input is a deterministic, self-contained request.",
      };
  }
}
