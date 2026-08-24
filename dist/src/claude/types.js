/**
 * Claude Managed Agents Integration types — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   This module defines the seam between UseSteady's authority system and
 *   Claude Managed Agents. It is the type contract for:
 *
 *     - ClaudeAgentHandoffArtifact: the approved, constrained artifact Claude receives
 *     - ClaudeDeliveryRequest: what the delivery gate sends to Claude
 *     - ClaudeDeliveryResponse: the three response kinds Claude may return
 *     - ClaudeScopeQuestion: Claude's structured scope clarification request
 *     - ClaudeToolPolicy: explicit tool + network + filesystem scope at handoff time
 *
 * ── Authority model ───────────────────────────────────────────────────────────
 *
 *   Claude Managed Agents: execute only.
 *   No upstream reach-back. No re-interpretation. No intent re-classification.
 *
 * ── Phase A locked truths (A1–A4) ────────────────────────────────────────────
 *
 *   A1 — executionDomain is mapper-derived, never reclassified downstream.
 *        The delivery gate may only validate presence and allowed values.
 *
 *   A2 — networkAccess: "allow_limited" is reserved and V1-blocked.
 *        "deny" is the only executable V1 value.
 *        The delivery gate rejects any artifact using "allow_limited".
 *
 *   A3 — Interrupted Claude sessions are non-resumable in V1.
 *        Interruption maps to refused_due_to_execution_error with
 *        code "session_interrupted". No resume path.
 *
 *   A4 — No callback loop from Claude to Intake exists in V1.
 *        The only mid-flight feedback path is structured scope clarification
 *        via ClaudeScopeQuestion, mediated by H.
 *
 * ── Key invariants ────────────────────────────────────────────────────────────
 *
 *   - ClaudeAgentHandoffArtifact never carries the original input string
 *   - eligibility === "approved_for_agent" is the only value that opens delivery
 *   - H may narrow scope only, never widen
 *   - Maximum one scope clarification per delivery attempt
 *   - toolPolicy.networkAccess must be "deny" in V1 (gate enforces)
 *   - toolPolicy.filesystemMode must be "scoped_only" (gate enforces)
 *   - Unknown response kinds are treated as refused_due_to_execution_error (fail-closed)
 *
 * ── Provenance chain ──────────────────────────────────────────────────────────
 *
 *   ucp.intent.v1 → ucp.response.v1 → ucp.claude_handoff.v1
 *     → ucp.claude_receipt.v1
 *       → [ucp.claude_result.v1 — RESERVED FUTURE SLOT]
 *         → ucp.execution_trace.v1 → ucp.replay_report.v1
 *
 *   Refusal path:
 *     ucp.claude_handoff.v1 → ucp.claude_refused.v1 (dead end or retry trigger)
 *
 *   Reserved future slots (not built in V1):
 *     ucp.claude_session.v1 — for managed session event history
 *     ucp.claude_result.v1  — for structured agent output
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */
/** Closed-enum membership list for runtime validation. */
export const MODEL_ADVISORY_KINDS = [
    "warning",
    "recommend_against",
    "uncertainty",
    "alternative",
];
/**
 * canonicalModelAdvisoryEvent — the exact canonical object whose hashObject
 * digest is the durable content-addressed `modelPositionId`. Field set and
 * value casing are protocol-fixed; do not extend without a named revision.
 */
export function canonicalModelAdvisoryEvent(position) {
    return {
        artifactId: position.artifactId,
        explanation: position.explanation,
        kind: position.kind,
        model: position.model,
        runtime: position.runtime,
    };
}
//# sourceMappingURL=types.js.map