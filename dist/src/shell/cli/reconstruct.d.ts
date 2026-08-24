/**
 * usesteady reconstruct — UCP-root-driven run reconstruction (SSOT P1).
 *
 * Read-only. Answers: given ucp_root_id + store, what happened?
 * Contract: docs/product/USESTEADY_RECONSTRUCT_COMMAND_V1.md
 */
import type { ChainVerification } from "../../ucp/chain-verification.js";
export type ReconstructOutputFormat = "text" | "json";
export type ReconstructCommandArgs = {
    readonly mode: "help";
} | {
    readonly mode: "reconstruct";
    readonly ucpRootId: string;
};
export type ReconstructChainEntry = {
    readonly id: string;
    readonly type: string;
    readonly ts: number;
};
export type ReconstructWorkflowTaskSummary = {
    readonly taskIndex: number;
    readonly outcome: string;
    readonly input: string | null;
};
export type ReconstructWorkflowSummary = {
    readonly workflowRunId: string;
    readonly workflowName: string;
    readonly finalOutcome: "completed" | "stopped";
    readonly taskCount: number;
    readonly tasks: readonly ReconstructWorkflowTaskSummary[];
};
export type ReconstructReplayStatus = {
    readonly checksum: string | null;
    readonly artifactPath: string | null;
    readonly artifactPresent: boolean;
    readonly replayReportVerdict: string | null;
};
export type ReconstructReport = {
    readonly schema: "usesteady.reconstruct.v1";
    readonly ucp_root_id: string;
    readonly store_dir: string;
    readonly store_dir_ephemeral: boolean;
    readonly status: "complete" | "partial" | "not_found";
    readonly intent_input: string | null;
    readonly chain: {
        readonly envelope_count: number;
        readonly entries: readonly ReconstructChainEntry[];
    };
    readonly chain_verification: ChainVerification | null;
    readonly workflow: ReconstructWorkflowSummary | null;
    readonly replay: ReconstructReplayStatus | null;
    readonly gaps: readonly string[];
};
export declare function resolveReconstructStoreDir(env?: Readonly<Record<string, string | undefined>>): string;
export declare function isEphemeralStoreDir(storeDir: string): boolean;
export declare function parseReconstructArgs(argv: readonly string[]): ReconstructCommandArgs | "usage-error";
export declare function buildReconstructReport(storeDir: string, ucpRootId: string): ReconstructReport;
export type ReconstructRunResult = {
    readonly text?: string;
    readonly json?: string;
    readonly exitCode: number;
};
/** Gaps that may appear in cert output but do not fail reconstruction status. */
export declare const RECONSTRUCT_INFORMATIONAL_GAP_CODES: readonly ["no_replay_report"];
export type ReconstructInformationalGapCode = (typeof RECONSTRUCT_INFORMATIONAL_GAP_CODES)[number];
/**
 * Gaps that fail reconstruction certification (Live Truth gate).
 * Workflow link and durable store are required for cert even when
 * chain-only partial reconstruction is still useful interactively.
 */
export declare function getBlockingGaps(gaps: readonly string[]): readonly string[];
export type ResolvedWorkflowUcpRoot = {
    readonly workflowRunId: string;
    readonly ucpRootId: string;
    readonly workflowName: string;
    readonly finalOutcome: "completed" | "stopped";
};
/** @deprecated alias — prefer ResolvedWorkflowUcpRoot */
export type ResolvedCompletedUcpRoot = ResolvedWorkflowUcpRoot;
/**
 * Resolve the most recent workflow's primary UCP root from the store.
 */
export declare function resolveLatestWorkflowUcpRoot(storeDir: string, options?: {
    readonly workflowName?: string;
    readonly finalOutcome?: "completed" | "stopped";
}): ResolvedWorkflowUcpRoot | null;
/**
 * Resolve the most recent completed workflow's primary UCP root from the store.
 * Optional workflowName filter for cert runs with a unique spec name.
 */
export declare function resolveLatestCompletedUcpRoot(storeDir: string, options?: {
    readonly workflowName?: string;
}): ResolvedWorkflowUcpRoot | null;
export type FailurePathScenario = "failed_execution" | "denied_approval";
export type IntegrityComparison = {
    readonly matches: boolean;
    readonly mismatch_fields: readonly string[];
    readonly recomputed: ChainVerification;
    readonly claimed: ChainVerification;
};
/** Compare recomputed chain verification against a claimed digest block. */
export declare function compareChainVerification(recomputed: ChainVerification, claimed: ChainVerification): IntegrityComparison;
export declare function explainIntegrityMismatch(comparison: IntegrityComparison): string;
export declare function assertFailurePathReconstructReport(report: ReconstructReport, scenario: FailurePathScenario): {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reasons: readonly string[];
};
export type MultiStepGovernanceTaskSummary = {
    readonly taskIndex: number;
    readonly outcome: string;
    readonly intentId: string | null;
    readonly approval_confirmed: boolean;
    readonly chain_envelope_count: number;
};
export type MultiStepGovernanceAudit = {
    readonly workflow_run_id: string;
    readonly task_count: number;
    readonly tasks_accepted: number;
    readonly intent_backed_tasks: number;
    readonly confirmed_approval_handoffs: number;
    readonly primary_chain_envelope_count: number;
    readonly tasks: readonly MultiStepGovernanceTaskSummary[];
};
/** Audit per-task outcomes and approval evidence for multi-step governance cert. */
export declare function auditMultiStepGovernance(storeDir: string, workflowRunId: string, primaryChainEnvelopeCount: number): MultiStepGovernanceAudit | null;
export declare function assertMultiStepCodeChangeCertReport(report: ReconstructReport, storeDir: string, options?: {
    readonly minTasks?: number;
    readonly minChainCount?: number;
    readonly minConfirmedApprovals?: number;
    readonly workflowRunId?: string;
}): {
    readonly ok: true;
    readonly governance: MultiStepGovernanceAudit;
} | {
    readonly ok: false;
    readonly reasons: readonly string[];
};
export declare function assertReconstructionCertReport(report: ReconstructReport): {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reasons: readonly string[];
};
export declare function runReconstruct(args: ReconstructCommandArgs, storeDir?: string, format?: ReconstructOutputFormat): ReconstructRunResult;
/** Test helper: list intent roots from recent workflow runs when ucp_root_id unknown. */
export declare function listKnownUcpRoots(storeDir: string): readonly string[];
//# sourceMappingURL=reconstruct.d.ts.map