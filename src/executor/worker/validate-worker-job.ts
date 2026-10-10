/**
 * Validate BackgroundJobRecord + lineage before worker action (INV-QWORK-2, INV-QWORK-8).
 */

import { persistedEntryPayloadHash } from "../jobs/job-id.js";
import type { BackgroundJobRecord } from "../jobs/types.js";
import type { WorkerJobValidationResult } from "./types.js";

function failure(
  rejection_cause: string,
  explain: string,
): WorkerJobValidationResult {
  return { ok: false, rejection_cause, explain };
}

function isLineageIncomplete(job: BackgroundJobRecord): boolean {
  if (job.lineage.length === 0) return true;
  for (const row of job.lineage) {
    if (row.execution_id.trim().length === 0) return true;
    if (row.ledger_entry_id.trim().length === 0) return true;
    if (row.handler_intent_id.trim().length === 0) return true;
    if (row.at.trim().length === 0) return true;
  }
  return false;
}

export function validateWorkerJob(job: BackgroundJobRecord): WorkerJobValidationResult {
  if (job.transport_state !== "enqueued") {
    return failure("transport_state_invalid", "Job transport_state must be enqueued.");
  }

  if (job.job_id.trim().length === 0) {
    return failure("job_id_missing", "job_id is required.");
  }

  if (job.idempotency_key.trim() !== job.job_id.trim()) {
    return failure(
      "idempotency_key_mismatch",
      "idempotency_key must match job_id in v1.",
    );
  }

  if (job.payload_hash.trim().length === 0) {
    return failure("payload_hash_missing", "payload_hash is required.");
  }

  const expectedHash = persistedEntryPayloadHash(job.persisted_entry);
  if (job.payload_hash.trim() !== expectedHash) {
    return failure(
      "payload_hash_mismatch",
      "payload_hash does not match persisted ledger fingerprint.",
    );
  }

  if (isLineageIncomplete(job)) {
    return failure("lineage_incomplete", "Job lineage is incomplete.");
  }

  const record = job.persisted_entry.record;
  if (record.execution_id.trim() !== job.execution_id.trim()) {
    return failure("execution_id_mismatch", "Job execution_id does not match persisted entry.");
  }

  if (record.ledger_entry_id.trim() !== job.ledger_entry_id.trim()) {
    return failure("ledger_entry_id_mismatch", "Job ledger_entry_id does not match persisted entry.");
  }

  if (record.handler_intent_id.trim() !== job.handler_intent_id.trim()) {
    return failure(
      "handler_intent_id_mismatch",
      "Job handler_intent_id does not match persisted entry.",
    );
  }

  return { ok: true };
}
