/**
 * usesteady audit summary — read-only operational insights (P3).
 *
 * Projection over existing UCP store only. No scoring, inference, or mutation.
 * Resume events and unattributed provider activity report unknown.
 */
import type { WorkflowAuditRecord } from "../../history/types.js";
export type AuditSummaryCommandArgs = {
    readonly mode: "help";
} | {
    readonly mode: "last";
};
export type AuditRunSummary = {
    readonly workflowRunId: string;
    readonly outcome: "completed" | "stopped";
    readonly tasks: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly skipped: number;
    readonly retries: number;
    readonly resumeEvents: number | "unknown";
    readonly providerCalls: number | "unknown";
};
export type AuditSummaryView = {
    readonly kind: "empty";
} | {
    readonly kind: "run";
    readonly summary: AuditRunSummary;
};
export declare function resolveAuditSummaryStoreDir(env?: Readonly<Record<string, string | undefined>>): string;
export declare function parseAuditSummaryArgs(argv: readonly string[]): AuditSummaryCommandArgs | "usage-error";
export declare function projectAuditRunSummary(audit: WorkflowAuditRecord): AuditRunSummary;
export declare function buildAuditSummaryView(storeDir: string, args: AuditSummaryCommandArgs): AuditSummaryView;
export declare function renderAuditSummaryText(view: AuditSummaryView): string;
export declare function renderAuditSummaryJson(view: AuditSummaryView): string;
export type AuditSummaryRunResult = {
    readonly stdout: string;
    readonly exitCode: 0 | 2;
};
export declare function runAuditSummary(args: AuditSummaryCommandArgs, storeDir?: string, format?: "text" | "json"): AuditSummaryRunResult;
export declare function renderAuditSummaryHelpText(): string;
export declare function renderAuditCommandHelpText(): string;
export declare function renderAuditSummaryUsageError(): string;
//# sourceMappingURL=audit-summary.d.ts.map