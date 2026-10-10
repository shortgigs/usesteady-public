/**
 * Background job transport record derivation — no execution / UI / persistence writes.
 */

import { backgroundJobId, persistedEntryPayloadHash } from "./job-id.js";
import type {
  BackgroundJobKind,
  BackgroundJobLineageEntry,
  BackgroundJobRecord,
  CreateBackgroundJobInput,
} from "./types.js";
import { BackgroundJobsRejectedError } from "./types.js";
import type { PersistedLedgerEntry } from "../persistence/types.js";

const ALLOWED_JOB_KINDS: readonly BackgroundJobKind[] = [
  "replay_notify",
  "retry_transport",
];

function reject(rejection_cause: string, explain: string): never {
  throw new BackgroundJobsRejectedError(rejection_cause, explain);
}

function isPersistedIncomplete(persisted: PersistedLedgerEntry): boolean {
  if (!Number.isInteger(persisted.sequence) || persisted.sequence < 0) return true;

  const record = persisted.record;
  if (record.ledger_entry_id.trim().length === 0) return true;
  if (record.handler_intent_id.trim().length === 0) return true;
  if (record.execution_id.trim().length === 0) return true;
  if (record.capability_id.trim().length === 0) return true;
  if (record.recorded_at.trim().length === 0) return true;
  if (record.lineage.length === 0) return true;
  if (record.intent_snapshot.handler_intent_id.trim().length === 0) return true;
  return false;
}

function buildLineage(
  persisted: PersistedLedgerEntry,
  enqueued_at: string,
): readonly BackgroundJobLineageEntry[] {
  const record = persisted.record;
  return [
    {
      at:                enqueued_at,
      kind:              "job_created",
      execution_id:      record.execution_id,
      ledger_entry_id:   record.ledger_entry_id,
      handler_intent_id: record.handler_intent_id,
      note:              "background job transport record created (no execution authority)",
    },
    {
      at:                enqueued_at,
      kind:              "transport_enqueued",
      execution_id:      record.execution_id,
      ledger_entry_id:   record.ledger_entry_id,
      handler_intent_id: record.handler_intent_id,
      note:              `store_sequence=${persisted.sequence}`,
    },
  ];
}

export function createBackgroundJob(input: CreateBackgroundJobInput): BackgroundJobRecord {
  const persisted = input.persisted;
  const job_kind = input.job_kind;

  if (!ALLOWED_JOB_KINDS.includes(job_kind)) {
    reject("job_kind_invalid", `Job kind ${job_kind} is not allowed in v1.`);
  }

  if (isPersistedIncomplete(persisted)) {
    reject("persisted_entry_incomplete", "Persisted ledger entry is incomplete.");
  }

  const record = persisted.record;
  const enqueued_at = record.recorded_at;

  const job_id = backgroundJobId({
    job_kind,
    execution_id:    record.execution_id,
    ledger_entry_id: record.ledger_entry_id,
    store_sequence:  persisted.sequence,
  });

  return {
    job_id,
    idempotency_key:   job_id,
    job_kind,
    execution_id:      record.execution_id,
    handler_intent_id: record.handler_intent_id,
    ledger_entry_id:   record.ledger_entry_id,
    capability_id:     record.capability_id,
    store_sequence:    persisted.sequence,
    payload_hash:      persistedEntryPayloadHash(persisted),
    enqueued_at,
    transport_state:   "enqueued",
    persisted_entry:   structuredClone(persisted),
    lineage:           buildLineage(persisted, enqueued_at),
  };
}
