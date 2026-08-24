/**
 * usage-events.jsonl — append-only local usage substrate (P2).
 *
 * Materialized from existing UCP store + consensus-audit.jsonl only.
 * No execution-path writes. No billing authority.
 *
 * D12 boundary (locked):
 *   Usage summary reports observed usage only.
 *   Tokens and cost are displayed only when directly recorded in existing
 *   artifacts or provider responses.
 *   No synthetic token estimation. No pricing tables. No cost inference.
 *   No retroactive reconstruction. Unknown is authoritative.
 */
export declare const USAGE_EVENT_SCHEMA: "usage-event.v1";
export declare const USAGE_EVENTS_FILENAME = "usage-events.jsonl";
/** Exported for tests — D12 invariant text must not drift. */
export declare const USAGE_D12_BOUNDARY: readonly ["Usage summary reports observed usage only.", "Tokens and cost are displayed only when directly recorded in existing artifacts.", "No synthetic token estimation. No pricing tables. No cost inference.", "No retroactive reconstruction. Unknown is authoritative."];
/**
 * Provider labels copied from observed store fields only.
 *   anthropic          — consensus pluginName "claude" or Claude delivery envelope
 *   openai-compatible  — consensus pluginName "openai-compatible" (verbatim audit label)
 *   openai | xai       — only when a future artifact field records them explicitly
 */
export type ObservedProviderLabel = "anthropic" | "openai-compatible" | "openai" | "xai";
export type UsageEventRecord = {
    readonly schemaVersion: typeof USAGE_EVENT_SCHEMA;
    readonly eventId: string;
    readonly eventType: "workflow_run" | "provider_call";
    readonly recordedAt: string;
    readonly workflowRunId?: string;
    readonly taskIndex?: number;
    readonly provider?: ObservedProviderLabel;
    readonly observedPluginName?: string;
    readonly callCount: number;
    readonly recordedTokens: number | null;
    readonly recordedCostUsd: number | null;
};
export type UsageSummary = {
    readonly runs: number;
    readonly providerCalls: number;
    readonly recordedTokens: number | null;
    readonly recordedCostUsd: number | null;
    readonly providerDistribution: Readonly<Record<ObservedProviderLabel, number>>;
};
export declare function usageEventsPath(storeDir?: string): string;
export declare function readUsageEvents(storeDir?: string): readonly UsageEventRecord[];
/** D12: only read numeric token/cost fields explicitly present on a source object. */
export declare function readRecordedUsageFields(source: Record<string, unknown>): {
    readonly recordedTokens: number | null;
    readonly recordedCostUsd: number | null;
};
/** Derive new events from store; append only ids not already present. Returns count appended. */
export declare function materializeUsageEvents(storeDir?: string): number;
export declare function aggregateUsageSummary(events: readonly UsageEventRecord[]): UsageSummary;
export declare function formatUsageInteger(value: number): string;
export declare function formatRecordedCostUsd(value: number | null): string;
export declare function formatRecordedTokens(value: number | null): string;
export declare function renderUsageSummaryText(summary: UsageSummary): string;
//# sourceMappingURL=usage-events.d.ts.map