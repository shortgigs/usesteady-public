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

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONSTITUTION_STORE_DIRNAME = "constitution-approvals";
export const APPROVAL_RECORD_JSONL_FILENAME = "approvals.jsonl";

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

export class ApprovalRecordError extends Error {
  constructor(public readonly cause_code: string, message: string) {
    super(message);
    this.name = "ApprovalRecordError";
  }
}

function approvalsPath(storeDir: string): string {
  return join(storeDir, CONSTITUTION_STORE_DIRNAME, APPROVAL_RECORD_JSONL_FILENAME);
}

/**
 * Append one approval record to the durable store.
 *
 * @param record   The fingerprint to persist with the approval.
 * @param storeDir The base store directory.
 */
export function recordApprovalBasis(record: ApprovalRecord, storeDir: string): ApprovalRecord {
  if (record.workflowRunId.trim().length === 0) {
    throw new ApprovalRecordError("approval_record_invalid", "workflowRunId is required.");
  }
  if (record.decisionBasisFingerprint.trim().length === 0) {
    throw new ApprovalRecordError("approval_record_invalid", "decisionBasisFingerprint is required.");
  }
  if (storeDir.trim().length === 0) {
    throw new ApprovalRecordError("approval_store_invalid", "storeDir is empty.");
  }

  const dir = join(storeDir, CONSTITUTION_STORE_DIRNAME);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(approvalsPath(storeDir), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    throw new ApprovalRecordError("approval_store_io_failed", "Failed to append approval record.");
  }
  return record;
}

/** Load every persisted approval record in append order. */
export function loadApprovalRecords(storeDir: string): readonly ApprovalRecord[] {
  const path = approvalsPath(storeDir);
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ApprovalRecordError("approval_store_io_failed", "Failed to read approval store.");
  }

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new ApprovalRecordError(
          "approval_store_corrupt",
          `Approval store line ${i + 1} is not valid JSON.`,
        );
      }
      return parsed as ApprovalRecord;
    });
}

/**
 * Return the latest approval record for a workflow run, or `null` if none.
 * Used at the execution boundary to recover the approved fingerprint.
 */
export function loadApprovalBasis(workflowRunId: string, storeDir: string): ApprovalRecord | null {
  const matches = loadApprovalRecords(storeDir).filter(
    (r) => r.workflowRunId === workflowRunId,
  );
  return matches.length === 0 ? null : matches[matches.length - 1]!;
}
