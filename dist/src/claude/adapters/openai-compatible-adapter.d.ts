/**
 * OpenAI-Compatible Agent Adapter.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   A ClaudeAgentPlugin implementation backed by any OpenAI-compatible API.
 *   Covers OpenAI models (GPT-4o, o1, etc.) and OpenAI-compatible endpoints
 *   such as xAI/Grok (https://api.x.ai/v1), Together, Fireworks, etc.
 *
 *   Translates ClaudeDeliveryRequest → OpenAI chat completions with function
 *   calling, then maps the response back to ClaudeDeliveryResponse.
 *
 * ── Why "OpenAi-compatible" not "OpenAI" ─────────────────────────────────────
 *
 *   The baseURL constructor option makes the runtime target configurable.
 *   Naming it "Compatible" avoids the future confusion of an adapter named
 *   "OpenAI" that is also talking to xAI or another provider.
 *
 * ── What this adapter does ────────────────────────────────────────────────────
 *
 *   1. Builds the same system prompt as ClaudeApiAdapter (from artifact constraints).
 *   2. Builds the user message from taskSpec ONLY (never from raw user input, A4).
 *   3. Maps allowedTools names to OpenAI function schemas.
 *   4. Always includes request_scope_clarification as a gate protocol function.
 *   5. Calls the OpenAI chat completions endpoint.
 *   6. Maps the response to ClaudeDeliveryResponse:
 *      - finish_reason "stop"        → accepted  (sessionId = completion.id)
 *      - tool_calls + scope function → refused_due_to_scope with candidates
 *      - tool_calls + other function → accepted (model used a task tool)
 *      - API error / timeout         → refused_due_to_execution_error
 *
 * ── Model Insertion Policy ────────────────────────────────────────────────────
 *
 *   Real API calls are made only when USESTEADY_USE_OPENAI_COMPAT === "true".
 *   When unset, the bypass plugin is used. In CI, callers pass ClaudeStubAdapter
 *   as the bypass to keep behaviour deterministic.
 *
 * ── Phase A locked truths (enforced here) ────────────────────────────────────
 *
 *   A1 — executionDomain is used as-is from the artifact. Never reclassified.
 *   A2 — networkAccess "deny" is enforced at the system prompt level.
 *   A3 — On interruption/timeout, code = "session_interrupted".
 *   A4 — User message is built from artifact.taskSpec only.
 *
 * See: src/claude/adapters/multi-llm-types.ts — normalization layer
 */
import OpenAI from "openai";
import type { ClaudeAgentPlugin } from "../delivery-gate.js";
import type { ClaudeDeliveryRequest, ClaudeDeliveryResponse } from "../types.js";
/**
 * Configuration for OpenAiCompatibleAgentAdapter.
 *
 *   apiKey    — API key for the provider. Required.
 *   baseURL   — Optional. Overrides the API base URL for non-OpenAI providers.
 *               Example: "https://api.x.ai/v1" for xAI/Grok.
 *   model     — Model ID. Defaults to "gpt-4o".
 *   maxTokens — Max tokens for the response. Defaults to 4096.
 *   timeoutMs — API call timeout. Defaults to 30 000 ms.
 *   bypass    — Deterministic fallback for CI and model-disabled environments.
 *   _openai   — Injectable OpenAI client for unit tests. Not for production use.
 */
export type OpenAiCompatibleAdapterConfig = {
    readonly apiKey: string;
    readonly baseURL?: string;
    readonly model?: string;
    readonly maxTokens?: number;
    readonly timeoutMs?: number;
    readonly bypass?: ClaudeAgentPlugin;
    readonly _openai?: Pick<OpenAI, "chat">;
};
/**
 * OpenAiCompatibleAgentAdapter — ClaudeAgentPlugin backed by an OpenAI-compatible API.
 *
 * OpenAI production:
 *   const adapter = new OpenAiCompatibleAgentAdapter({ apiKey: process.env.OPENAI_API_KEY! });
 *
 * xAI / Grok:
 *   const adapter = new OpenAiCompatibleAgentAdapter({
 *     apiKey:  process.env.XAI_API_KEY!,
 *     baseURL: "https://api.x.ai/v1",
 *     model:   "grok-3",
 *   });
 *
 * CI (model disabled):
 *   const adapter = new OpenAiCompatibleAgentAdapter({
 *     apiKey: "ci-key",
 *     bypass: ClaudeStubAdapter.accepted("ci-session"),
 *   });
 */
export declare class OpenAiCompatibleAgentAdapter implements ClaudeAgentPlugin {
    private readonly client;
    private readonly model;
    private readonly maxTokens;
    private readonly bypass;
    constructor(config: OpenAiCompatibleAdapterConfig);
    receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse>;
    get isLive(): boolean;
}
//# sourceMappingURL=openai-compatible-adapter.d.ts.map