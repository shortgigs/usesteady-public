/**
 * applyGuidanceOrdering — session-aware guidance step ordering.
 *
 * This is Phase B2 of session memory alignment. It takes a finalized
 * GuidancePayload and applies two purely presentational adjustments based
 * on observedIntentPatterns from the InteractionContract:
 *
 *   1. Step type ordering: read_first always before use_exact_format (defensive).
 *   2. Label emphasis: when the user is familiar with a category
 *      (≥ FAMILIARITY_THRESHOLD observations), the read_first label
 *      shortens to action-first form (drops "first" — they know the flow).
 *
 * ── HARD INVARIANTS (must never be violated) ─────────────────────────────────
 *
 *   1. Step count never changes. No step is added. No step is removed.
 *   2. missing[] is never modified.
 *   3. interpretation (category, confidence, summary, basis) is never modified.
 *   4. mode, reason, signal, intentState are NOT touched (not in this type).
 *   5. Counts may only affect ordering and label text — never content truth.
 *   6. A required safe step (read_first) is never suppressed.
 *   7. If counts tie across categories, ordering is deterministic (stable sort).
 *   8. Label changes use only the current guidance's interpretation category.
 *      A high text_change count never alters a visual_color label.
 *
 * ── This function is purely presentational ───────────────────────────────────
 *
 * It is called after all intake decisions are made. It cannot and must not
 * feed back into PRV, safety, context alignment, disambiguation, completion,
 * response planning, or interpretation category/confidence.
 */

import type { ObservedIntentPatterns } from "./types.js";
import type { GuidancePayload } from "../understand/intent-interpretation/types.js";
import type { CompletionNextStep } from "../understand/completion/types.js";
import type { IntentInterpretationCategory } from "../understand/intent-interpretation/types.js";

/**
 * Number of same-category guided recovery observations required before
 * the read_first label switches to the shorter, action-first form.
 *
 * Below threshold → default label (explains the "why" for new users).
 * At or above threshold → familiar label (shorter, action-first).
 */
export const FAMILIARITY_THRESHOLD = 3;

/**
 * Preferred sort order for step types.
 * read_first is always promoted to the front.
 * add_missing_field stays in the middle.
 * use_exact_format is last.
 *
 * This is a defensive guarantee — the bridge already produces this order,
 * but this makes it an explicit, tested property of every guidance payload.
 */
const STEP_TYPE_ORDER: Readonly<Record<CompletionNextStep["type"], number>> = {
  read_first:       0,
  add_missing_field: 1,
  use_exact_format:  2,
};

/**
 * Shorter, action-first read_first labels for users familiar with the flow.
 * Applied only when patterns[category] >= FAMILIARITY_THRESHOLD.
 *
 * Default labels contain "first" as a cue for new users ("Read the file FIRST").
 * Familiar labels drop that cue — experienced users already know the order.
 */
const FAMILIAR_READ_FIRST_LABELS: Partial<Record<IntentInterpretationCategory, string>> = {
  visual_color:  'Find the current color value in the component file: "<file>"',
  text_change:   'Find the current text value in the file: "<file>"',
  config_change: 'Find the current setting in the config file: "<file>"',
};

/**
 * Apply session-aware ordering to a GuidancePayload.
 *
 * Returns a new GuidancePayload with:
 *   - nextSteps sorted by type (read_first → add_missing_field → use_exact_format)
 *   - read_first label adjusted to familiar form when patterns[category] >= 3
 *
 * All other fields (missing, interpretation, reason) are returned unchanged.
 *
 * This is a pure function: deterministic, no side effects.
 */
export function applyGuidanceOrdering(
  guidance: GuidancePayload,
  patterns: ObservedIntentPatterns,
): GuidancePayload {
  const category  = guidance.interpretation?.category;
  const isFamiliar = isFamiliarCategory(category, patterns);

  // Step 1: Sort by type. Stable sort preserves relative order within type.
  const sorted = sortByStepType(guidance.nextSteps);

  // Step 2: Adjust read_first labels for familiar categories only.
  const adjusted = isFamiliar ? adjustReadFirstLabels(sorted, category!) : sorted;

  // Return with only nextSteps replaced. Everything else is unchanged.
  if (adjusted === guidance.nextSteps) {
    return guidance;
  }
  return {
    ...guidance,
    nextSteps: adjusted,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFamiliarCategory(
  category: IntentInterpretationCategory | undefined,
  patterns: ObservedIntentPatterns,
): category is "visual_color" | "text_change" | "config_change" {
  if (category === undefined || category === "unknown" || category === "workflow_operation") return false;
  return patterns[category] >= FAMILIARITY_THRESHOLD;
}

function sortByStepType(
  steps: readonly CompletionNextStep[],
): readonly CompletionNextStep[] {
  // Already sorted? Return the same reference (no allocation).
  if (isAlreadySorted(steps)) return steps;

  // Stable sort: spread to mutable, sort with index as tiebreaker.
  return [...steps].sort((a, b) => {
    const diff = STEP_TYPE_ORDER[a.type] - STEP_TYPE_ORDER[b.type];
    if (diff !== 0) return diff;
    // Same type — preserve original order (stable).
    return steps.indexOf(a) - steps.indexOf(b);
  });
}

function isAlreadySorted(steps: readonly CompletionNextStep[]): boolean {
  for (let i = 1; i < steps.length; i++) {
    if (STEP_TYPE_ORDER[steps[i - 1]!.type] > STEP_TYPE_ORDER[steps[i]!.type]) {
      return false;
    }
  }
  return true;
}

function adjustReadFirstLabels(
  steps: readonly CompletionNextStep[],
  category: "visual_color" | "text_change" | "config_change",
): readonly CompletionNextStep[] {
  const familiarLabel = FAMILIAR_READ_FIRST_LABELS[category];
  if (familiarLabel === undefined) return steps;

  // Only rewrite if there are read_first steps to adjust.
  const hasReadFirst = steps.some(s => s.type === "read_first");
  if (!hasReadFirst) return steps;

  return steps.map(step =>
    step.type === "read_first"
      ? { ...step, label: familiarLabel }
      : step,
  );
}
