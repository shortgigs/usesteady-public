/**
 * Provider registry — the single source of truth for AI providers across
 * UseSteady (UI + CLI + server).
 *
 * Issue: #150 — "add provider-agnostic credential pre-flight blocking".
 *
 * Design rules:
 *
 *   1. Provider-agnostic. There is no hardcoded Anthropic branching anywhere
 *      in the credential / live-mode path. Every provider-specific decision
 *      is declared as data here.
 *
 *   2. `runtimes` is the mapping layer. A workflow task's `runtime` field
 *      (e.g. "claude") is looked up against each provider's `runtimes`
 *      array to determine which provider — if any — it requires.
 *      The `cursor` runtime is intentionally NOT listed on any provider:
 *      it runs locally and needs no AI credentials.
 *
 *   3. Live mode is per-provider. `liveModeEnv` is the env var that opts
 *      the provider into live API execution. If undefined, the provider
 *      is considered live whenever its `envKey` is set. Today only
 *      Anthropic has a legacy opt-in toggle (`USESTEADY_USE_CLAUDE=true`).
 *
 *   4. This file is pure config. No side effects. Safe to import from
 *      browser code (UI), server code, and CLI code.
 *
 * Spec reference:
 *   - #150 step 1 (provider registry)
 *   - #150 step 3 (runtime → provider mapping)
 */

export type AIProvider = {
  /** Stable machine id. Used as the foreign key everywhere. */
  readonly id: string;

  /** Human-readable name shown in UI banners and CLI errors. */
  readonly displayName: string;

  /** Process env var that carries the API key. */
  readonly envKey: string;

  /** Where to send the user to generate a key. Optional. */
  readonly setupUrl?: string;

  /**
   * Workflow task `runtime` values that route to this provider.
   * A task whose runtime is not listed here does not require this provider.
   */
  readonly runtimes: readonly string[];

  /**
   * Optional env var that gates live execution for this provider.
   * When undefined, the provider is considered live whenever `envKey` is set.
   * When set, `process.env[liveModeEnv] === liveModeEnvExpectedValue` must
   * hold for live mode. Mismatch → demo / stub path.
   */
  readonly liveModeEnv?: string;

  /** Value expected in `liveModeEnv` to enable live mode. Defaults to "true". */
  readonly liveModeEnvExpectedValue?: string;
};

/**
 * Registered providers. Extend this array to add new providers — every
 * downstream helper (credential detection, live-mode, UI blocking, CLI
 * guard) will automatically cover the new provider without code changes.
 */
export const PROVIDERS: readonly AIProvider[] = [
  {
    id:                       "anthropic",
    displayName:              "Anthropic",
    envKey:                   "ANTHROPIC_API_KEY",
    setupUrl:                 "https://console.anthropic.com/settings/keys",
    runtimes:                 ["claude"],
    // Legacy opt-in toggle retained for backwards compatibility with the
    // pre-#150 CLI flag. New providers are encouraged to omit this and
    // rely on envKey presence alone.
    liveModeEnv:              "USESTEADY_USE_CLAUDE",
    liveModeEnvExpectedValue: "true",
  },
  {
    id:          "openai",
    displayName: "OpenAI",
    envKey:      "OPENAI_API_KEY",
    setupUrl:    "https://platform.openai.com/api-keys",
    runtimes:    ["gpt", "openai"],
  },
];
