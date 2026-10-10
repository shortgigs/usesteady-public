/**
 * Multi-provider visibility for `usesteady doctor` (P1-1).
 *
 * Read-only env presence only. No routing, provider selection, or execution.
 */

export type ProviderConfiguredStatus = "configured" | "not configured";

export type ProviderVisibilitySnapshot = {
  readonly anthropic: ProviderConfiguredStatus;
  readonly openai: ProviderConfiguredStatus;
  readonly xai: ProviderConfiguredStatus;
  readonly consensusMode: "on" | "off";
};

const CONSENSUS_MODES = new Set(["multi", "multi-strict"]);

function envConfigured(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): ProviderConfiguredStatus {
  return env[key]?.trim() ? "configured" : "not configured";
}

/** Env presence only — never reads or prints key material. */
export function probeProviderVisibility(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderVisibilitySnapshot {
  const llmMode = env["USESTEADY_LLM_MODE"]?.trim() ?? "claude";
  return {
    anthropic:      envConfigured(env, "ANTHROPIC_API_KEY"),
    openai:         envConfigured(env, "OPENAI_API_KEY"),
    xai:            envConfigured(env, "XAI_API_KEY"),
    consensusMode:  CONSENSUS_MODES.has(llmMode) ? "on" : "off",
  };
}

export function renderProviderVisibilityLines(
  snapshot: ProviderVisibilitySnapshot,
): readonly string[] {
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
