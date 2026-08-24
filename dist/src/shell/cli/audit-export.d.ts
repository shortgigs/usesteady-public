/**
 * usesteady audit export — read-only workflow run export bundle.
 *
 * P0-3: exports existing UCP store fields only. Zero authority — no
 * enforcement, signing, encryption, or store mutation.
 *
 * D2 boundary: `tasks`/`timeline` are SessionChain-derived (WorkflowAuditRecord
 * + timeline projection). `artifacts` are RunTimeline-derived (getTimeline per
 * intentId). Separate top-level arrays — never merged into one chain.
 */
import { type RunTimeline } from "../../ucp/persistence/query.js";
import { type TimelineTaskRow } from "../../history/timeline-projection.js";
import type { WorkflowTaskAuditEntry } from "../../history/types.js";
export type AuditExportOutputMode = "json" | "file";
export type AuditExportCommandArgs = {
    readonly mode: "help";
} | {
    readonly mode: "export";
    readonly runId: string;
    readonly output: AuditExportOutputMode;
};
export type AuditExportBundle = {
    readonly workflowRunId: string;
    readonly workflowName: string;
    readonly finalOutcome: "completed" | "stopped";
    readonly tasks: readonly WorkflowTaskAuditEntry[];
    readonly timeline: readonly TimelineTaskRow[];
    readonly artifacts: readonly AuditExportArtifactEntry[];
};
export type AuditExportArtifactEntry = {
    readonly taskIndex: number;
    readonly intentId: string;
    readonly intent: RunTimeline["intent"];
    readonly response: RunTimeline["response"];
    readonly artifact: RunTimeline["artifact"];
    readonly trace: RunTimeline["trace"];
    readonly replay: RunTimeline["replay"];
    readonly reminderExecution: RunTimeline["reminderExecution"];
};
export type AuditExportError = {
    readonly kind: "missing_run_id";
} | {
    readonly kind: "run_not_found";
    readonly runId: string;
};
export type AuditExportResult = {
    readonly kind: "ok";
    readonly bundle: AuditExportBundle;
    readonly filePath?: string;
} | {
    readonly kind: "error";
    readonly error: AuditExportError;
};
/** Advanced override for tests; not advertised in v1 help text. */
export declare function resolveAuditExportStoreDir(env?: Readonly<Record<string, string | undefined>>): string;
export declare function parseAuditExportArgs(argv: readonly string[], outputMode: AuditExportOutputMode | null): AuditExportCommandArgs | "usage-error";
export declare function buildAuditExportBundle(storeDir: string, runId: string): AuditExportResult;
export declare function auditExportFilePath(runId: string, cwd?: string): string;
export declare function renderAuditExportJson(result: AuditExportResult): string;
export type AuditExportRunResult = {
    readonly stdout: string;
    readonly exitCode: number;
};
export declare function runAuditExport(args: AuditExportCommandArgs, options?: {
    readonly storeDir?: string;
    readonly cwd?: string;
}): AuditExportRunResult;
export declare function renderAuditExportHelpText(): string;
export declare function renderMissingRunIdError(): string;
//# sourceMappingURL=audit-export.d.ts.map