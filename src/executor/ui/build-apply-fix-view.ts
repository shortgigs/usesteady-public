/**
 * Apply Fix read-only view projection — no writes, job triggers, or execution.
 */

import type { BackgroundJobRecord } from "../jobs/types.js";
import type {
  ApplyFixLineageRow,
  ApplyFixViewModel,
  BuildApplyFixViewInput,
} from "./types.js";
import { ApplyFixUiRejectedError } from "./types.js";

const OPERATOR_PATH_NOTE =
  "Presentation only. Advance execution through operator-confirmed CLI/API paths — not this view.";

function reject(rejection_cause: string, explain: string): never {
  throw new ApplyFixUiRejectedError(rejection_cause, explain);
}

function isJobIncomplete(job: BackgroundJobRecord): boolean {
  if (job.job_id.trim().length === 0) return true;
  if (job.idempotency_key.trim().length === 0) return true;
  if (job.execution_id.trim().length === 0) return true;
  if (job.ledger_entry_id.trim().length === 0) return true;
  if (job.handler_intent_id.trim().length === 0) return true;
  if (job.lineage.length === 0) return true;
  if (job.persisted_entry.record.intent_snapshot.intent_summary.trim().length === 0) {
    return true;
  }
  return false;
}

function buildLineageRows(job: BackgroundJobRecord): readonly ApplyFixLineageRow[] {
  const ledger = job.persisted_entry.record;
  const intent = ledger.intent_snapshot;
  const rows: ApplyFixLineageRow[] = [];

  for (const entry of intent.lineage) {
    rows.push({
      at:                entry.at,
      source:            "handler_intent",
      kind:              entry.kind,
      execution_id:      intent.execution_id,
      ledger_entry_id:   ledger.ledger_entry_id,
      handler_intent_id: intent.handler_intent_id,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    });
  }

  for (const entry of ledger.lineage) {
    rows.push({
      at:                entry.at,
      source:            "ledger",
      kind:              entry.kind,
      execution_id:      ledger.execution_id,
      ledger_entry_id:   ledger.ledger_entry_id,
      handler_intent_id: ledger.handler_intent_id,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    });
  }

  for (const entry of job.lineage) {
    rows.push({
      at:                entry.at,
      source:            "job",
      kind:              entry.kind,
      execution_id:      entry.execution_id,
      ledger_entry_id:   entry.ledger_entry_id,
      handler_intent_id: entry.handler_intent_id,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    });
  }

  return rows;
}

export function buildApplyFixView(input: BuildApplyFixViewInput): ApplyFixViewModel {
  const job = input.job;

  if (isJobIncomplete(job)) {
    reject("apply_fix_view_incomplete", "Background job record is incomplete for view projection.");
  }

  if (job.idempotency_key !== job.job_id) {
    reject("apply_fix_view_incomplete", "Job idempotency_key must match job_id.");
  }

  const ledger = job.persisted_entry.record;
  const intent = ledger.intent_snapshot;

  return {
    view_id:           job.job_id,
    authority: {
      kind:    "presentation_only",
      message: "This view is descriptive only and has no execution authority.",
    },
    job_id:            job.job_id,
    idempotency_key:   job.idempotency_key,
    job_kind:          job.job_kind,
    transport_state:   job.transport_state,
    execution_id:      job.execution_id,
    capability_id:     job.capability_id,
    handler_intent_id: job.handler_intent_id,
    ledger_entry_id:   job.ledger_entry_id,
    store_sequence:    job.store_sequence,
    intent_summary:    intent.intent_summary,
    target_scope:      [...intent.target_scope],
    risk_notes:        [...intent.risk_notes],
    actor_id:          ledger.actor.actor_id,
    recorded_at:       ledger.recorded_at,
    enqueued_at:       job.enqueued_at,
    payload_hash:      job.payload_hash,
    lineage_rows:      buildLineageRows(job),
    operator_path_note: OPERATOR_PATH_NOTE,
  };
}
