/**
 * Interaction Contract updater — pure function.
 *
 * applyInteractionEvent(contract, event) → nextContract
 *
 * Rules:
 *   - Never mutates. Returns a new contract object.
 *   - Transitions are deterministic: same event always produces same delta.
 *   - Source becomes "observed" after any event-driven update.
 *   - updatedAt is set by the caller via timestamp argument (keeps function pure).
 *
 * ── Observation events (visual_color, text_change, config_change) ─────────────
 *
 * These increment the corresponding observedIntentPatterns count.
 * All other contract fields are left unchanged.
 *
 * ADVISORY ONLY — see InteractionContract type for the full contract.
 * These counts may never influence mode, safety, completion, or interpretation.
 */

import type { InteractionContract, InteractionEvent } from "./types.js";

export function applyInteractionEvent(
  contract: InteractionContract,
  event: InteractionEvent,
  updatedAt: string = new Date().toISOString(),
): InteractionContract {
  switch (event.type) {
    case "misinterpretation_corrected":
      // User corrected a misinterpretation → be more conservative with ambiguity.
      return {
        ...contract,
        ambiguityMode: trendConservative(contract.ambiguityMode),
        source:        "observed",
        updatedAt,
      };

    case "unsupported_recovered":
      // User successfully recovered from unsupported input → note which style helped.
      return {
        ...contract,
        unsupportedGuidanceMode: recoveryStyleToMode(event.recoveryStyle),
        source:                  "observed",
        updatedAt,
      };

    // ── Observation events ──────────────────────────────────────────────────
    // Increment one observed intent pattern count. No other field changes.
    // These events are produced only by observeIntentPattern() after verifying
    // that bridgeFired === true in the debug trace.

    case "color_intent_observed":
      return {
        ...contract,
        observedIntentPatterns: {
          ...contract.observedIntentPatterns,
          visual_color: contract.observedIntentPatterns.visual_color + 1,
        },
        source:    "observed",
        updatedAt,
      };

    case "text_intent_observed":
      return {
        ...contract,
        observedIntentPatterns: {
          ...contract.observedIntentPatterns,
          text_change: contract.observedIntentPatterns.text_change + 1,
        },
        source:    "observed",
        updatedAt,
      };

    case "config_intent_observed":
      return {
        ...contract,
        observedIntentPatterns: {
          ...contract.observedIntentPatterns,
          config_change: contract.observedIntentPatterns.config_change + 1,
        },
        source:    "observed",
        updatedAt,
      };
  }
}

// ─── Transition helpers ───────────────────────────────────────────────────────

function trendConservative(
  current: InteractionContract["ambiguityMode"],
): InteractionContract["ambiguityMode"] {
  if (current === "fast") return "balanced";
  return "conservative";
}

function recoveryStyleToMode(
  style: "syntax_hint" | "example_used" | "stepwise_followed",
): InteractionContract["unsupportedGuidanceMode"] {
  switch (style) {
    case "syntax_hint":       return "syntax_first";
    case "example_used":      return "examples_first";
    case "stepwise_followed": return "stepwise";
  }
}
