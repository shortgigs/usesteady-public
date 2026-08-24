/**
 * usesteady usage summary — read-only local usage + cost visibility (P2).
 *
 * Materializes append-only usage-events.jsonl from existing store data,
 * then aggregates. No execution, billing, or hosted dashboard.
 *
 * D12: observed usage only — see usage-events.ts USAGE_D12_BOUNDARY.
 */
export type UsageCommandArgs = {
    readonly mode: "help";
} | {
    readonly mode: "summary";
};
export declare function parseUsageArgs(argv: readonly string[]): UsageCommandArgs | "usage-error";
export declare function renderUsageHelpText(): string;
export type UsageSummaryResult = {
    readonly exitCode: 0 | 2;
    readonly stdout: string;
    readonly stderr: string;
};
export declare function runUsageSummary(storeDir?: string): UsageSummaryResult;
export declare function runUsageCommand(args: UsageCommandArgs, options?: {
    readonly storeDir?: string;
}): UsageSummaryResult;
//# sourceMappingURL=usage-summary.d.ts.map