/**
 * Presentation formatter — formatIntakeResult.
 *
 * Converts an IntakeResult into a consumer-ready PresentationOutput.
 * No logic here. No decisions. Only translation.
 *
 * ── UCP boundary note ─────────────────────────────────────────────────────────
 *
 * UCP is canonical source of truth, but presentation consumes projected IntakeResult.
 * Direct UCP consumption is deferred to Phase 2 integration.
 *
 * In Phase 2, PresentationOutput may be derived directly from UCPBundle instead
 * of from IntakeResult, using the response envelope as the authoritative source.
 * Until then, IntakeResult is the presentation input and UCP is a parallel view.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 *
 * The presentation layer sits above the intake pipeline.
 * It takes already-decided IntakeResult data and formats it for display.
 *
 * ── What this is not ─────────────────────────────────────────────────────────
 *
 * This layer does NOT:
 *   - Re-run intake, completion, or interpretation
 *   - Add new decisions or modify existing ones
 *   - Guess values or invent context
 *   - Render HTML, terminal escape codes, or markdown
 *
 * ── Dual interpretation families ─────────────────────────────────────────────
 *
 * IntentInterpretation (guide mode)
 *   → category comes from IntentInterpretationCategory
 *   → lives at result.guidance.interpretation
 *   → display names: "Color / style change", "Text / copy change", "Configuration change"
 *
 * InterpretationResult (execute mode)
 *   → category comes from InterpretationCategory
 *   → lives at result.interpretation
 *   → display names: "Tailwind color change", "CSS color change", etc.
 *
 * These are never merged. One is for guide. One is for execute.
 */

import type { IntakeResult } from "../intake/types.js";
import type { ResponseMode } from "../intake/types.js";
import type { DebugTrace } from "../intake/trace.js";
import type { IntentInterpretationCategory } from "../understand/intent-interpretation/types.js";
import type { InterpretationCategory } from "../understand/interpretation/types.js";
import type { PresentationOutput } from "./types.js";

// ─── Display name maps ────────────────────────────────────────────────────────

const MODE_BADGES: Record<ResponseMode, string> = {
  refuse:  "REFUSE",
  ignore:  "IGNORE",
  clarify: "CLARIFY",
  guide:   "GUIDE",
  execute: "EXECUTE",
};

const CONFIDENCE_LABELS: Record<"high" | "medium" | "low", string> = {
  high:   "High confidence",
  medium: "Medium confidence",
  low:    "Low confidence",
};

// Intent interpretation (guide mode — what the user appears to be trying to do)
const INTENT_CATEGORY_LABELS: Record<IntentInterpretationCategory, string> = {
  visual_color:       "Color / style change",
  text_change:        "Text / copy change",
  config_change:      "Configuration change",
  workflow_operation: "Development workflow",
  unknown:            "Unclassified",
};

// Change interpretation (execute mode — what the structured change means)
const CHANGE_CATEGORY_LABELS: Record<InterpretationCategory, string> = {
  tailwind_color_change: "Tailwind color change",
  css_color_change:      "CSS color change",
  text_literal_change:   "Text / copy change",
  config_value_change:   "Configuration value change",
};

// ─── certaintyLevel derivation ────────────────────────────────────────────────

/**
 * Purely derived — no logic authority.
 *
 * "certain"  → execute + change interpretation (structured patch, known meaning)
 * "inferred" → guide + intent interpretation (vague but classified)
 * "unknown"  → all other cases (refuse, ignore, clarify, bare execute, incomplete guide)
 */
function deriveCertaintyLevel(
  result: IntakeResult,
): "certain" | "inferred" | "unknown" {
  if (result.mode === "execute" && result.interpretation !== undefined) return "certain";
  if (result.mode === "guide"   && result.guidance?.interpretation !== undefined) return "inferred";
  return "unknown";
}

// ─── formatIntakeResult ───────────────────────────────────────────────────────

/**
 * Format an IntakeResult into a consumer-ready PresentationOutput.
 *
 * @param result  The intake pipeline result
 * @param trace   Optional debug trace from runIntakeWithTrace.
 *                When provided, it is attached to debugTrace on the output.
 *                It has zero effect on any other field.
 *
 * The result is deterministic: same inputs → same output.
 */
export function formatIntakeResult(
  result: IntakeResult,
  trace?: DebugTrace,
): PresentationOutput {
  const badge          = MODE_BADGES[result.mode];
  const certaintyLevel = deriveCertaintyLevel(result);
  const traceField     = trace !== undefined ? { debugTrace: trace } : {};

  // ── guide mode with intent interpretation (guided_recovery + classification) ─
  if (result.mode === "guide" && result.guidance?.interpretation !== undefined) {
    const interp = result.guidance.interpretation;
    return {
      mode:       result.mode,
      badge,
      headline:   interp.summary,
      category:   INTENT_CATEGORY_LABELS[interp.category],
      confidence: CONFIDENCE_LABELS[interp.confidence],
      steps:      result.guidance.nextSteps.map((s) => s.label),
      missing:    [...result.guidance.missing],
      certaintyLevel,
      ...traceField,
    };
  }

  // ── guide mode without intent interpretation (incomplete, or no classification) ─
  if (result.mode === "guide" && result.guidance !== undefined) {
    return {
      mode:     result.mode,
      badge,
      headline: result.reason,
      steps:    result.guidance.nextSteps.map((s) => s.label),
      missing:  [...result.guidance.missing],
      certaintyLevel,
      ...traceField,
    };
  }

  // ── execute mode with change interpretation ────────────────────────────────
  if (result.mode === "execute" && result.interpretation !== undefined) {
    const interp = result.interpretation;
    return {
      mode:       result.mode,
      badge,
      headline:   interp.summary,
      category:   CHANGE_CATEGORY_LABELS[interp.category],
      confidence: CONFIDENCE_LABELS[interp.confidence],
      certaintyLevel,
      ...traceField,
    };
  }

  // ── refuse / ignore / clarify / execute (no interpretation) ───────────────
  return {
    mode:     result.mode,
    badge,
    headline: result.reason,
    certaintyLevel,
    ...traceField,
  };
}
