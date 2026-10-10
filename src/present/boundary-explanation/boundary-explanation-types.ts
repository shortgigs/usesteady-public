/**
 * Boundary Explanation types — Phase 5C.
 *
 * Provides human-legible explanations for correct-but-confusing routing decisions.
 *
 * ── Authority constraint ──────────────────────────────────────────────────────
 *
 *   Boundary explanations are metadata only.
 *   They describe decisions that have already been made.
 *   They do not re-evaluate, override, or change any routing decision.
 *   They do not affect CVG signal levels.
 *   They do not affect confirm enablement.
 *
 * ── Stacking rule ────────────────────────────────────────────────────────────
 *
 *   Exactly one explanation may appear per presentation result.
 *   First-match-wins. No stacking. No combining.
 */

// ─── Code ─────────────────────────────────────────────────────────────────────

/**
 * BoundaryExplanationCode — the semantic identity of the boundary encountered.
 *
 *   question_form_needs_action   Input was phrased as a question, not a command.
 *   multi_intent_first_only      Compound input: only the first action was processed.
 *   needs_specific_target        Intent is clear but the target location is missing.
 *   policy_may_block_target      Target is structurally reachable but may be policy-blocked.
 *   scope_must_be_narrowed       Scope is too broad to act on safely.
 *   not_ready_missing_fields     Required fields are absent (reminder path).
 */
export type BoundaryExplanationCode =
  | "question_form_needs_action"
  | "multi_intent_first_only"
  | "needs_specific_target"
  | "policy_may_block_target"
  | "scope_must_be_narrowed"
  | "not_ready_missing_fields";

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * BoundaryExplanation — one explanation attached to a presentation result.
 *
 *   code     — stable identifier used by consumers for rendering decisions
 *   message  — deterministic, human-readable explanation text
 *
 * This field is either absent (no boundary detected) or present (one boundary).
 * It is never null. It never stacks.
 */
export type BoundaryExplanation = {
  readonly code:    BoundaryExplanationCode;
  readonly message: string;
};
