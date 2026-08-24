/**
 * Constitution Materialization V1 — durable approval record.
 *
 * Implements USESTEADY_CONSTITUTION_V1 Article VI step 3: persist the Decision
 * Basis fingerprint WITH the approval record, so the decision is recertifiable
 * later (INV-TMP-1 — the fingerprint is provenance).
 *
 * This is the I/O boundary. The pure coordinator never writes here; it carries
 * the fingerprint in memory on the WorkflowRun. This module is the durable form
 * available to callers that persist approvals (shell / server), mirroring the
 * append-only JSONL pattern in src/executor/persistence.
 *
 * Append-only. Local filesystem only. No network, no external trust.
 */
export declare const CONSTITUTION_STORE_DIRNAME = "constitution-approvals";
export declare const APPROVAL_RECORD_JSONL_FILENAME = "approvals.jsonl";
/**
 * One persisted approval record: a workflow run's Decision Basis fingerprint,
 * captured at approval time.
 */
export type ApprovalRecord = {
    readonly workflowRunId: string;
    /** SHA-256 hex of the Decision Basis (Article VI). */
    readonly decisionBasisFingerprint: string;
    /** ISO-8601 capture time. */
    readonly capturedAt: string;
};
export declare class ApprovalRecordError extends Error {
    readonly cause_code: string;
    constructor(cause_code: string, message: string);
}
/**
 * Append one approval record to the durable store.
 *
 * @param record   The fingerprint to persist with the approval.
 * @param storeDir The base store directory.
 */
export declare function recordApprovalBasis(record: ApprovalRecord, storeDir: string): ApprovalRecord;
/** Load every persisted approval record in append order. */
export declare function loadApprovalRecords(storeDir: string): readonly ApprovalRecord[];
/**
 * Return the latest approval record for a workflow run, or `null` if none.
 * Used at the execution boundary to recover the approved fingerprint.
 */
export declare function loadApprovalBasis(workflowRunId: string, storeDir: string): ApprovalRecord | null;
//# sourceMappingURL=approval-record.d.ts.map