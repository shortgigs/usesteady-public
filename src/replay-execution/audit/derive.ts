/**
 * Derive ReplayExecutionAuditEntry from POST context (record-only).
 */

import type { ReplayExecutionRecord } from "../types.js";
import type { ReplayExecutionAuditEntry } from "./types.js";
import { ReplayExecutionAuditRejectedError } from "./types.js";
import { resolveOperatorIdFromWorkerResult } from "./operator.js";
import type { WorkerResultRecord } from "../../executor/worker/types.js";

export function auditEntryId(replay_execution_id: string): string {
  return `prex-audit:${replay_execution_id.trim()}`;
}

export function sourceRecordRef(replay_execution_id: string): string {
  return `prex-record:${replay_execution_id.trim()}`;
}

export function deriveReplayExecutionAuditEntry(input: {
  readonly job_id: string;
  readonly worker_result: WorkerResultRecord;
  readonly replay_execution: ReplayExecutionRecord;
}): ReplayExecutionAuditEntry {
  const job_id = input.job_id.trim();
  if (job_id.length === 0) {
    throw new ReplayExecutionAuditRejectedError(
      "request_incomplete",
      "job_id is required to derive replay execution audit entry.",
    );
  }

  const operator_id = resolveOperatorIdFromWorkerResult(input.worker_result);
  if (operator_id === undefined) {
    throw new ReplayExecutionAuditRejectedError(
      "operator_unknown",
      "operator_id could not be resolved from execution evidence.",
    );
  }

  const record = input.replay_execution;
  const replay_execution_id = record.replay_execution_id.trim();
  if (replay_execution_id.length === 0) {
    throw new ReplayExecutionAuditRejectedError(
      "audit_record_incomplete",
      "replay_execution_id is required for audit append.",
    );
  }

  return {
    audit_entry_id:          auditEntryId(replay_execution_id),
    job_id,
    operator_id,
    replay_sandbox_id:       record.replay_sandbox_id,
    replay_execution_id,
    replay_execution_state:  record.replay_execution_state,
    recorded_at:             record.replay_execution_created_at,
    replay_execution_version: record.replay_execution_version,
    replay_execution_reason: record.replay_execution_reason,
    source_record_ref:       sourceRecordRef(replay_execution_id),
  };
}
