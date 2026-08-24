/**
 * Cursor Integration types.
 *
 * ── Role of this module ────────────────────────────────────────────────────────
 *
 *   This module defines the seam between UseSteady's authority system and
 *   Cursor's edit machinery. It is the type contract for:
 *
 *     - CursorHandoffArtifact: the approved, constrained artifact Cursor receives
 *     - CursorDeliveryRequest: what the delivery gate sends to Cursor
 *     - CursorResponse: the three response kinds Cursor may return
 *     - CursorScopeQuestion: Cursor's structured scope clarification request
 *     - CursorOCDPolicy: the policy inputs for the OCD evaluator
 *
 * ── Authority model ────────────────────────────────────────────────────────────
 *
 *   PROPOSE    parsedChange.filePath   (artifact mapper only)
 *   CONSTRAIN  OCD policy engine       (conflicts + prohibitedPatterns)
 *   REFINE     H at ready_for_confirmation (set from empty or narrow non-empty)
 *   SELECT     H at scope_clarification (from Cursor's candidates only)
 *
 *   Cursor: execute only. No upstream reach-back. No re-interpretation.
 *
 * ── Key invariants ─────────────────────────────────────────────────────────────
 *
 *   - CursorHandoffArtifact never carries the original input string
 *   - eligibility === "approved_for_cursor" is the only value that opens delivery
 *   - H can set allowedFiles from empty or narrow non-empty; cannot widen non-empty
 *   - H-provided paths are validated against workspace boundary (hard block)
 *     and write_safe_globs (OCD conflict trigger)
 *   - Maximum one scope clarification per delivery sequence
 *
 * ── Provenance chain ───────────────────────────────────────────────────────────
 *
 *   ucp.intent.v1 → ucp.response.v1 → ucp.cursor_handoff.v1
 *     → ucp.cursor_receipt.v1
 *       → [ucp.cursor_artifact.v1 — RESERVED FUTURE SLOT]
 *         → ucp.execution_trace.v1 → ucp.replay_report.v1
 *
 *   Refusal path:
 *     ucp.cursor_handoff.v1 → ucp.cursor_refused.v1 (dead end or retry trigger)
 *
 * See: docs/cursor-integration-architecture.md
 *      docs/cursor-delivery-contract.md
 *      docs/cursor-allowedfiles-policy.md
 */
export {};
//# sourceMappingURL=types.js.map