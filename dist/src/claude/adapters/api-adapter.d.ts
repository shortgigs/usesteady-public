/**
 * Claude API Adapter — Phase 8C.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   The real ClaudeAgentPlugin implementation. Translates a ClaudeDeliveryRequest
 *   into an Anthropic API call and maps the response back to ClaudeDeliveryResponse.
 *
 *   This is the transport-specific adapter the delivery gate uses when operating
 *   against the real Anthropic API. It replaces ClaudeStubAdapter in production.
 *
 * ── What this adapter does ────────────────────────────────────────────────────
 *
 *   1. Builds a system prompt from artifact constraints (allowedFiles,
 *      prohibitedPatterns, allowedTools, executionDomain).
 *   2. Builds the user message from taskSpec ONLY — never from raw user input.
 *   3. Maps allowedTools names to Anthropic tool schemas (known-tool registry).
 *   4. Always includes `request_scope_clarification` as a gate protocol tool.
 *   5. Calls the Anthropic messages API.
 *   6. Maps the API response to ClaudeDeliveryResponse:
 *      - stop_reason "end_turn"    → accepted  (sessionId = API response id)
 *      - tool_use + scope tool     → refused_due_to_scope with candidates
 *      - tool_use + other          → accepted (Claude used a task tool; session live)
 *      - API error / timeout       → refused_due_to_execution_error
 *      - Network interruption      → refused_due_to_execution_error (code: session_interrupted)
 *
 * ── Model Insertion Policy (Section 9.5) ─────────────────────────────────────
 *
 *   This module calls the Anthropic API. A deterministic bypass path is required.
 *   Bypass is provided by passing `bypass: ClaudeAgentPlugin` in the config and
 *   setting the environment variable USESTEADY_USE_CLAUDE to any value other than "true".
 *   In CI, callers use ClaudeStubAdapter as the bypass.
 *
 * ── Phase A locked truths (enforced here) ────────────────────────────────────
 *
 *   A1 — We never re-classify executionDomain. We use artifact.executionDomain as-is.
 *   A2 — networkAccess "deny" is enforced at the system prompt level: no HTTP tools.
 *   A3 — On interruption/timeout, we return session_interrupted (non-resumable).
 *   A4 — We never call back into Intake. We use only artifact.taskSpec for prompts.
 *
 * ── Candidate generation (Phase 8C) ──────────────────────────────────────────
 *
 *   When Claude calls `request_scope_clarification`, it provides candidates from
 *   within allowedFiles (or searches within the workspace for real candidate paths).
 *   This is the Phase 8C upgrade over the stub, which used pre-configured candidates.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeAgentPlugin } from "../delivery-gate.js";
import type { ClaudeDeliveryRequest, ClaudeDeliveryResponse } from "../types.js";
/**
 * Configuration for ClaudeApiAdapter.
 *
 *   apiKey         — Anthropic API key. Required.
 *   model          — Anthropic model ID. Defaults to "claude-opus-4-5".
 *   maxTokens      — Max tokens for the response. Defaults to 4096.
 *   timeoutMs      — API call timeout. Defaults to 30 000 ms.
 *   bypass         — Deterministic fallback plugin (model insertion policy).
 *                    Used when USESTEADY_USE_CLAUDE !== "true".
 *   _anthropic     — Injectable Anthropic client (for testing only).
 *                    When provided, the real Anthropic client is not created.
 */
export type ClaudeApiAdapterConfig = {
    readonly apiKey: string;
    readonly model?: string;
    readonly maxTokens?: number;
    readonly timeoutMs?: number;
    /** Deterministic fallback for CI and model-disabled environments. */
    readonly bypass?: ClaudeAgentPlugin;
    /** Injectable Anthropic client for unit tests. Not for production use. */
    readonly _anthropic?: Pick<Anthropic, "messages">;
};
/**
 * ClaudeApiAdapter — real ClaudeAgentPlugin backed by the Anthropic API.
 *
 * Production usage:
 *   const adapter = new ClaudeApiAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! });
 *   const gate    = new ClaudeDeliveryGate(adapter, storeDir);
 *
 * CI usage (model disabled):
 *   const adapter = new ClaudeApiAdapter({
 *     apiKey: "ci-key",
 *     bypass: ClaudeStubAdapter.accepted("ci-session"),
 *   });
 *   // USESTEADY_USE_CLAUDE is unset → bypass is used automatically
 */
export declare class ClaudeApiAdapter implements ClaudeAgentPlugin {
    private readonly client;
    private readonly model;
    private readonly maxTokens;
    private readonly timeoutMs;
    private readonly bypass;
    constructor(config: ClaudeApiAdapterConfig);
    receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse>;
    /** Returns true if the adapter is configured to make real API calls. */
    get isLive(): boolean;
}
//# sourceMappingURL=api-adapter.d.ts.map