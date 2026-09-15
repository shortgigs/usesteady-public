/**
 * observeIntentPattern — pure gate function for session observation.
 *
 * This function decides whether the current pipeline result warrants
 * emitting an intent observation event to update the InteractionContract.
 *
 * ── Why this gate exists ────────────────────────────────────────────────────
 *
 * Session memory must only track meaningful guided interpretations — not
 * generic inputs, incomplete completions, or unclassified vague noise.
 *
 * Without this gate, the observed counts would be contaminated by:
 *   - inputs that short-circuited early (PRV, safety, context)
 *   - inputs the bridge never evaluated
 *   - execute / clarify / refuse flows that have nothing to learn from
 *
 * ── Hard invariants (must never be violated) ────────────────────────────────
 *
 *   1. No event fires unless result.mode === "guide".
 *      Execution, refusal, and clarification flows are excluded.
 *
 *   2. No event fires unless result.guidance?.interpretation is defined.
 *      The bridge must have produced a classification.
 *
 *   3. No event fires unless trace.bridgeFired === true.
 *      This is the explicit confirmation that the bridge ran and succeeded.
 *      If no trace is provided, this condition is not met — no event fires.
 *
 *   4. No event fires for category "unknown".
 *      Only the three meaningful categories (visual_color, text_change,
 *      config_change) produce observation events.
 *
 *   5. The returned event is advisory only.
 *      It must flow through applyInteractionEvent() before any contract
 *      is updated. It does not mutate anything itself.
 *
 *   6. This function does not affect and must never be used to infer:
 *        - mode, intentState, responseMode
 *        - safety verdict, PRV result
 *        - completion result, interpretation category/confidence
 */

import type { DebugTrace } from "../intake/trace.js";
import type { IntakeResult } from "../intake/types.js";
import type { InteractionEvent } from "./types.js";

/**
 * Evaluate whether the pipeline result warrants an intent observation event.
 *
 * Returns an InteractionEvent if all four hard conditions are met:
 *   1. result.mode === "guide"
 *   2. result.guidance.interpretation is defined
 *   3. trace.bridgeFired === true
 *   4. interpretation.category is one of: visual_color, text_change, config_change
 *
 * Returns null in all other cases. Null is a valid, correct response.
 */
export function observeIntentPattern(
  result: IntakeResult,
  trace?: DebugTrace,
): InteractionEvent | null {
  // Gate 1: only guide mode produces meaningful observations.
  if (result.mode !== "guide") {
    return null;
  }

  // Gate 2: bridge must have produced an interpretation.
  const interpretation = result.guidance?.interpretation;
  if (interpretation === undefined) {
    return null;
  }

  // Gate 3: explicit trace confirmation that the bridge actually fired.
  // If trace is absent, bridgeFired is unknown — default to safe (no event).
  if (trace?.bridgeFired !== true) {
    return null;
  }

  // Gate 4: map meaningful categories to observation events.
  // "unknown" category is excluded — it carries no useful session signal.
  switch (interpretation.category) {
    case "visual_color":  return { type: "color_intent_observed" };
    case "text_change":   return { type: "text_intent_observed" };
    case "config_change": return { type: "config_intent_observed" };
    default:              return null;
  }
}
