/**
 * Claude Delivery Gate — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   The delivery gate is the ONLY path through which a ClaudeAgentHandoffArtifact
 *   reaches Claude Managed Agents. It enforces these invariants before any delivery:
 *
 *     1. Eligibility: artifact.eligibility === "approved_for_agent"
 *     2. Tool policy: toolPolicy.networkAccess === "deny" (V1 lock, A2)
 *     3. Tool policy: toolPolicy.filesystemMode === "scoped_only"
 *     4. Tool policy: allowedTools is non-empty
 *     5. Persistence: ucp.claude_handoff.v1 persisted before Claude is called
 *     6. Immutability: artifact delivered === artifact persisted (same id)
 *
 *   After delivery, it persists either ucp.claude_receipt.v1 (accepted) or
 *   ucp.claude_refused.v1 (refused) based on Claude's response.
 *
 * ── Three delivery paths ──────────────────────────────────────────────────────
 *
 *   Path A (happy):  persist handoff → call Claude → accepted → persist receipt
 *   Path B (scope):  persist handoff → call Claude → refused_due_to_scope
 *                      → persist refused → surface scope question
 *   Path C (error):  persist handoff → call Claude → refused_due_to_execution_error
 *                      → persist refused → rejected
 *
 *   Unknown response kinds → treated as refused_due_to_execution_error (fail-closed).
 *
 * ── Plugin contract ───────────────────────────────────────────────────────────
 *
 *   ClaudeAgentPlugin.receive() is the only call the gate makes into Claude.
 *   The plugin must:
 *     - Accept only ClaudeDeliveryRequest
 *     - Return only ClaudeDeliveryResponse (one of three kinds)
 *     - NOT reach back into the intake pipeline (A4)
 *     - NOT call persistEnvelope (the gate owns all persistence)
 *
 * ── Persistence semantics ─────────────────────────────────────────────────────
 *
 *   ucp.claude_handoff.v1  — safety-critical (persistStrict): blocks delivery if fails
 *   ucp.claude_receipt.v1  — audit-critical (persistBestEffort): logs gap if fails
 *   ucp.claude_refused.v1  — audit-critical (persistBestEffort): logs gap if fails
 *   ucp.model_advisory.v1  — audit-critical (persistBestEffort): per advisory position
 *   ucp.model_evidence_basis.v1 — audit-critical (persistBestEffort): P4 child of
 *                            advisory / scope-refusal envelopes; system-derived
 *                            from the request BEFORE the model is called
 *
 * ── deliveryId semantics ──────────────────────────────────────────────────────
 *
 *   deliveryId is a delivery-attempt identifier, NOT a content identifier.
 *   Never use it for provenance chain links — use artifact.artifactId for those.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */
import type { UCPEnvelope } from "../ucp/types.js";
import { type RetiredPositionRef } from "./objection-retirement.js";
import type { ClaudeAgentHandoffArtifact, ClaudeDeliveryRequest, ClaudeDeliveryResponse, ClaudeScopeQuestion, ModelAdvisoryPosition, ModelAdvisoryRecord, RetiredAdvisoryContext } from "./types.js";
/**
 * The interface the delivery gate uses to communicate with Claude Managed Agents.
 *
 * This is the mechanism-agnostic seam. Implementations may use:
 *   - Direct Anthropic API calls (real Claude adapter)
 *   - Stub responses (test adapter)
 *
 * The plugin must NOT:
 *   - Re-derive intent from context (A1)
 *   - Reach back to the intake pipeline (A4)
 *   - Execute outside allowedFiles (gate-enforced upstream)
 *   - Use tools not in allowedTools (gate-enforced upstream)
 *   - Call persistEnvelope (the gate owns all persistence)
 */
export interface ClaudeAgentPlugin {
    receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse>;
}
export type ClaudeDeliveryGateResult = {
    readonly outcome: "accepted";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly receiptEnvelopeId: string;
    readonly sessionId: string;
} | {
    readonly outcome: "refused_due_to_scope";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly refusedEnvelopeId: string;
    readonly scopeQuestion: ClaudeScopeQuestion;
} | {
    /**
     * P3 Phase 2: the model emitted structured advisory position(s) and did
     * NOT execute. Each position was validated and persisted as
     * ucp.model_advisory.v1 (best-effort); the records carry the durable
     * content-addressed modelPositionId and the evidence envelope id.
     */
    readonly outcome: "advisory";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly positions: readonly ModelAdvisoryRecord[];
} | {
    /**
     * P5 V1: every returned advisory was a reassertion of a retired
     * position (same identity / same or unknown grounds). Recorded as
     * ucp.retired_position_reassertion.v1. Does not park.
     */
    readonly outcome: "retired_reassertion";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly reassertions: readonly ModelAdvisoryRecord[];
} | {
    readonly outcome: "refused_due_to_execution_error";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly refusedEnvelopeId: string;
    readonly errorCode: string;
    readonly message: string;
} | {
    readonly outcome: "blocked_ineligible";
    readonly reason: string;
} | {
    readonly outcome: "blocked_tool_policy";
    readonly reason: string;
} | {
    readonly outcome: "blocked_persistence_failure";
    readonly reason: string;
};
export type ClaudeGateDeps = {
    /**
     * Persistence function for the critical handoff envelope.
     * MUST throw on failure — a failure blocks delivery entirely.
     */
    persistStrict?: (envelope: UCPEnvelope<unknown>) => void;
    /**
     * Persistence function for non-critical envelopes (receipt, refused).
     * Must NOT throw — errors are swallowed.
     */
    persistBestEffort?: (envelope: UCPEnvelope<unknown>) => void;
};
export declare class ClaudeDeliveryGate {
    private readonly plugin;
    private readonly storeDir;
    private readonly persistStrict;
    private readonly persistBestEffort;
    constructor(plugin: ClaudeAgentPlugin, storeDir: string, deps?: ClaudeGateDeps);
    /**
     * Deliver a ClaudeAgentHandoffArtifact to Claude Managed Agents.
     *
     * CONTRACT — callers must ensure:
     *   - artifact.eligibility === "approved_for_agent" (gate re-checks and blocks if not)
     *   - artifact.toolPolicy.networkAccess === "deny" (gate re-checks, A2)
     *   - artifact.approvedAt is set (H has confirmed)
     *
     * CONTRACT — this function guarantees:
     *   - ucp.claude_handoff.v1 persisted BEFORE Claude is called
     *   - If persistence fails, Claude is NOT called (blocked_persistence_failure)
     *   - ucp.claude_receipt.v1 persisted when Claude returns "accepted"
     *   - ucp.claude_refused.v1 persisted when Claude returns any refusal
     *   - ucp.model_advisory.v1 persisted (per position) when Claude returns "advisory"
     *   - Receipt/refusal/advisory persistence failures do not block the state transition
     *   - Unknown response kinds map to refused_due_to_execution_error (fail-closed)
     *
     * P3 Phase 2: `opts.priorAdvisories` carries advisory positions a human has
     * explicitly superseded for THIS artifact into the re-delivery request as
     * informational context. Zero authority; never changes gate semantics.
     */
    deliver(artifact: ClaudeAgentHandoffArtifact, opts?: {
        readonly priorAdvisories?: readonly ModelAdvisoryPosition[];
        readonly retiredPositions?: readonly RetiredPositionRef[];
        readonly retiredAdvisories?: readonly RetiredAdvisoryContext[];
    }): Promise<ClaudeDeliveryGateResult>;
    private tryPersistBestEffort;
}
//# sourceMappingURL=delivery-gate.d.ts.map