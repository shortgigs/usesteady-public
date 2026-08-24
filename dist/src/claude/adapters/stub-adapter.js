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
// ─── Stub adapter ─────────────────────────────────────────────────────────────
/**
 * A configurable in-process ClaudeAgentPlugin.
 *
 * Configured at construction with a fixed response or a sequence of responses.
 * Returns responses immediately (no async delay).
 * Throws if a call is made beyond the configured responses.
 */
export class ClaudeStubAdapter {
    responses;
    callIndex = 0;
    constructor(responses) {
        if (responses.length === 0) {
            throw new Error("ClaudeStubAdapter: responses must not be empty");
        }
        this.responses = responses;
    }
    async receive(request) {
        const response = this.responses[this.callIndex];
        if (response === undefined) {
            throw new Error(`ClaudeStubAdapter: no response configured for call index ${this.callIndex} ` +
                `(deliveryId=${request.deliveryId})`);
        }
        this.callIndex++;
        return response;
    }
    /** How many times receive() has been called. */
    get callCount() { return this.callIndex; }
    // ─── Factory methods ───────────────────────────────────────────────────────
    /** Adapter that always returns "accepted" with the given sessionId. */
    static accepted(sessionId = "stub-session-id") {
        return new ClaudeStubAdapter([ClaudeStubAdapter.acceptedResponse(sessionId)]);
    }
    /** Adapter that returns a scope refusal with the given question. */
    static refusedScope(question) {
        return new ClaudeStubAdapter([ClaudeStubAdapter.scopeRefusalResponse(question)]);
    }
    /** Adapter that returns an execution error with the given code. */
    static refusedError(code = "stub_error", message = "Stub execution error.") {
        return new ClaudeStubAdapter([ClaudeStubAdapter.executionErrorResponse(code, message)]);
    }
    /** Adapter that simulates a session interruption (A3: non-resumable). */
    static sessionInterrupted() {
        return new ClaudeStubAdapter([
            ClaudeStubAdapter.executionErrorResponse("session_interrupted", "Claude managed session was interrupted. Non-resumable in V1."),
        ]);
    }
    /** Adapter that returns responses in sequence. Throws if exhausted. */
    static sequence(responses) {
        return new ClaudeStubAdapter(responses);
    }
    /**
     * Adapter that returns a structured model advisory (P3 Phase 2).
     * Positions are supplied fully formed — the stub, like the API adapter,
     * stamps artifactId/runtime/model at construction time via
     * `advisoryResponse`; tests construct them against the artifact under test.
     */
    static advisory(positions) {
        return new ClaudeStubAdapter([ClaudeStubAdapter.advisoryResponse(positions)]);
    }
    // ─── Response builders ─────────────────────────────────────────────────────
    static acceptedResponse(sessionId = "stub-session-id") {
        return {
            kind: "accepted",
            sessionId,
        };
    }
    static scopeRefusalResponse(question) {
        return {
            kind: "refused_due_to_scope",
            question,
        };
    }
    /**
     * Build an advisory response (P3 Phase 2). The caller supplies the complete
     * positions (kind + explanation + stamped artifactId/runtime/model) — the
     * stub never fabricates or mutates position content.
     */
    static advisoryResponse(positions) {
        return {
            kind: "advisory",
            positions,
        };
    }
    static executionErrorResponse(code = "stub_error", message = "Stub execution error.", messageOrigin) {
        return {
            kind: "refused_due_to_execution_error",
            code,
            message,
            ...(messageOrigin !== undefined ? { messageOrigin } : {}),
        };
    }
}
//# sourceMappingURL=stub-adapter.js.map