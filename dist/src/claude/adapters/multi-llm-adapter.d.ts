/**
 * MultiLlmPlugin — multi-LLM consensus adapter.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   Implements ClaudeAgentPlugin. Fans out a single ClaudeDeliveryRequest to
 *   multiple inner plugins, runs bounded consensus rounds under evaluatePolicy(),
 *   and returns the primary plugin's ClaudeDeliveryResponse.
 *
 *   The gate contract is unchanged. ClaudeDeliveryGate still calls plugin.receive()
 *   exactly as documented. This adapter is transparent to the gate.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a planner. Task specs are fixed at WorkflowSpec definition time.
 *   NOT an authority. Human approval is still required before delivery reaches here.
 *   NOT a conversation thread. Plugins do not share message history with each other.
 *
 * ── Consensus definition ──────────────────────────────────────────────────────
 *
 *   Consensus is NOT "multiple plugins returned accepted."
 *   Consensus is: all plugins produced matching NormalizedDecision.hash values.
 *   See evaluatePolicy() in multi-llm-types.ts — six-rule fail-closed precedence.
 *
 * ── Primary plugin ────────────────────────────────────────────────────────────
 *
 *   MultiLlmOptions.primary determines which plugin's ClaudeDeliveryResponse is
 *   returned to the gate. The primary is never selected by position.
 *   Non-primary plugins are used for consensus validation only.
 *
 * ── Audit record ──────────────────────────────────────────────────────────────
 *
 *   Every receive() call writes a ConsensusAuditRecord (INV-ML-6). P4: the
 *   record is appended to a durable JSONL sink (consensus-audit.jsonl under
 *   the resolved store dir; see consensus-audit-sink.ts) AND mirrored to
 *   process.stderr as a diagnostic line (prefixed "[consensus-audit]"). Both
 *   channels are best-effort — failures do not affect the returned
 *   ClaudeDeliveryResponse. Consensus rules and hashes are unchanged.
 *
 *   The quorumState and policyMode fields in the record are the two fields that
 *   make post-incident debugging tractable.
 *
 * See: src/claude/adapters/multi-llm-types.ts — types and evaluatePolicy()
 */
import type { ClaudeAgentPlugin } from "../delivery-gate.js";
import type { ClaudeDeliveryRequest, ClaudeDeliveryResponse } from "../types.js";
import { DEFAULT_MULTI_LLM_OPTIONS, type MultiLlmOptions } from "./multi-llm-types.js";
export type NamedPlugin = {
    readonly name: string;
    readonly plugin: ClaudeAgentPlugin;
};
/**
 * MultiLlmPlugin — ClaudeAgentPlugin that runs consensus across multiple plugins.
 *
 * Construction:
 *   const multi = new MultiLlmPlugin(
 *     { name: "claude", plugin: claudeAdapter },
 *     [{ name: "openai-compatible", plugin: openAiAdapter }],
 *     { primary: "claude", policyMode: "multi", requireUnanimity: false, ... },
 *   );
 *
 * The primaryPlugin entry must match options.primary.
 * The gate calls multi.receive() exactly as it would any ClaudeAgentPlugin.
 */
export declare class MultiLlmPlugin implements ClaudeAgentPlugin {
    private readonly primaryEntry;
    private readonly secondaryPlugins;
    private readonly options;
    constructor(primaryEntry: NamedPlugin, secondaryPlugins: readonly NamedPlugin[], options: Omit<MultiLlmOptions, keyof typeof DEFAULT_MULTI_LLM_OPTIONS> & Partial<Pick<MultiLlmOptions, keyof typeof DEFAULT_MULTI_LLM_OPTIONS>>);
    receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse>;
    private runRound;
    private callWithTimeout;
    private findScopeResponse;
}
//# sourceMappingURL=multi-llm-adapter.d.ts.map