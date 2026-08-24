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
/** Env presence only — never reads or prints key material. */
export declare function probeProviderVisibility(env?: Readonly<Record<string, string | undefined>>): ProviderVisibilitySnapshot;
export declare function renderProviderVisibilityLines(snapshot: ProviderVisibilitySnapshot): readonly string[];
//# sourceMappingURL=provider-visibility.d.ts.map