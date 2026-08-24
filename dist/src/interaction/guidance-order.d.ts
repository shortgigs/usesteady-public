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
/**
 * Number of same-category guided recovery observations required before
 * the read_first label switches to the shorter, action-first form.
 *
 * Below threshold → default label (explains the "why" for new users).
 * At or above threshold → familiar label (shorter, action-first).
 */
export declare const FAMILIARITY_THRESHOLD = 3;
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
export declare function applyGuidanceOrdering(guidance: GuidancePayload, patterns: ObservedIntentPatterns): GuidancePayload;
//# sourceMappingURL=guidance-order.d.ts.map