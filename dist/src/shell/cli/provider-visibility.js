/**
 * Multi-provider visibility for `usesteady doctor` (P1-1).
 *
 * Read-only env presence only. No routing, provider selection, or execution.
 */
const CONSENSUS_MODES = new Set(["multi", "multi-strict"]);
function envConfigured(env, key) {
    return env[key]?.trim() ? "configured" : "not configured";
}
/** Env presence only — never reads or prints key material. */
export function probeProviderVisibility(env = process.env) {
    const llmMode = env["USESTEADY_LLM_MODE"]?.trim() ?? "claude";
    return {
        anthropic: envConfigured(env, "ANTHROPIC_API_KEY"),
        openai: envConfigured(env, "OPENAI_API_KEY"),
        xai: envConfigured(env, "XAI_API_KEY"),
        consensusMode: CONSENSUS_MODES.has(llmMode) ? "on" : "off",
    };
}
export function renderProviderVisibilityLines(snapshot) {
    return [
        "",
        "  AI execution: deterministic by default.",
        "    An optional LLM provider can be enabled via USESTEADY_USE_LLM — OpenAI,",
        "    Anthropic, or any OpenAI-compatible endpoint (e.g. xAI/Grok).",
        "    Anthropic/Claude can also be enabled via USESTEADY_USE_CLAUDE.",
        "    Providers are peers — none is designated primary.",
        "",
        "  Configured providers:",
        `    Anthropic: ${snapshot.anthropic}`,
        `    OpenAI: ${snapshot.openai}`,
        `    xAI: ${snapshot.xai}`,
        `    Consensus mode: ${snapshot.consensusMode}`,
    ];
}
//# sourceMappingURL=provider-visibility.js.map