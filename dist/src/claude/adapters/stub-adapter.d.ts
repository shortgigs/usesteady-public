/**
 * Claude Stub Adapter — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   The stub adapter is the first concrete implementation of ClaudeAgentPlugin.
 *   It proves that the mechanism-agnostic contract works — the same delivery gate
 *   operates identically whether the plugin returns a response immediately (stub)
 *   or asynchronously (real Anthropic API client).
 *
 * ── Transport proof ───────────────────────────────────────────────────────────
 *
 *   ClaudeStubAdapter proves all three delivery paths:
 *     - accepted:                       stub returns ClaudeAccepted
 *     - refused_due_to_scope:           stub returns ClaudeRefusedDueToScope
 *     - refused_due_to_execution_error: stub returns ClaudeRefusedDueToExecutionError
 *
 *   The gate does not change behavior based on which adapter is used.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   In tests:
 *     const plugin = ClaudeStubAdapter.accepted("session-xyz");
 *     const gate   = new ClaudeDeliveryGate(plugin, storeDir, deps);
 *     const result = await gate.deliver(approvedArtifact);
 *     expect(result.outcome).toBe("accepted");
 *
 *   For a configurable sequence (scope refusal then accept):
 *     const plugin = ClaudeStubAdapter.sequence([
 *       ClaudeStubAdapter.scopeRefusalResponse({ questionKind: "need_file_path", ... }),
 *       ClaudeStubAdapter.acceptedResponse("session-abc"),
 *     ]);
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   This is not a fake Anthropic API. It does not execute tasks, read files,
 *   or produce real agent outputs. It is purely for proving the delivery gate
 *   contract works against all three response kinds.
 *
 * See: src/claude/delivery-gate.ts — ClaudeAgentPlugin interface
 */
import type { ClaudeAgentPlugin } from "../delivery-gate.js";
import type { ClaudeDeliveryRequest } from "../types.js";
import type { ClaudeDeliveryResponse, ClaudeAccepted, ClaudeAdvisoryPositions, ClaudeRefusedDueToScope, ClaudeRefusedDueToExecutionError, ClaudeScopeQuestion, ModelAdvisoryPosition } from "../types.js";
/**
 * A configurable in-process ClaudeAgentPlugin.
 *
 * Configured at construction with a fixed response or a sequence of responses.
 * Returns responses immediately (no async delay).
 * Throws if a call is made beyond the configured responses.
 */
export declare class ClaudeStubAdapter implements ClaudeAgentPlugin {
    private readonly responses;
    private callIndex;
    constructor(responses: ClaudeDeliveryResponse[]);
    receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse>;
    /** How many times receive() has been called. */
    get callCount(): number;
    /** Adapter that always returns "accepted" with the given sessionId. */
    static accepted(sessionId?: string): ClaudeStubAdapter;
    /** Adapter that returns a scope refusal with the given question. */
    static refusedScope(question: ClaudeScopeQuestion): ClaudeStubAdapter;
    /** Adapter that returns an execution error with the given code. */
    static refusedError(code?: string, message?: string): ClaudeStubAdapter;
    /** Adapter that simulates a session interruption (A3: non-resumable). */
    static sessionInterrupted(): ClaudeStubAdapter;
    /** Adapter that returns responses in sequence. Throws if exhausted. */
    static sequence(responses: ClaudeDeliveryResponse[]): ClaudeStubAdapter;
    /**
     * Adapter that returns a structured model advisory (P3 Phase 2).
     * Positions are supplied fully formed — the stub, like the API adapter,
     * stamps artifactId/runtime/model at construction time via
     * `advisoryResponse`; tests construct them against the artifact under test.
     */
    static advisory(positions: readonly ModelAdvisoryPosition[]): ClaudeStubAdapter;
    static acceptedResponse(sessionId?: string): ClaudeAccepted;
    static scopeRefusalResponse(question: ClaudeScopeQuestion): ClaudeRefusedDueToScope;
    /**
     * Build an advisory response (P3 Phase 2). The caller supplies the complete
     * positions (kind + explanation + stamped artifactId/runtime/model) — the
     * stub never fabricates or mutates position content.
     */
    static advisoryResponse(positions: readonly ModelAdvisoryPosition[]): ClaudeAdvisoryPositions;
    static executionErrorResponse(code?: string, message?: string, messageOrigin?: "model" | "adapter"): ClaudeRefusedDueToExecutionError;
}
//# sourceMappingURL=stub-adapter.d.ts.map