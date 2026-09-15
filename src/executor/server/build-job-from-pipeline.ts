/**
 * Derive BackgroundJobRecord from certified pipeline input (no UI / no worker invoke).
 */

import { appendExecutionLedgerRecord } from "../ledger/append-execution-ledger-record.js";
import { executeProposal } from "../runtime/execute-proposal.js";
import { invokeHandlerIntent } from "../handler/invoke-handler-intent.js";
import {
  appendLedgerEntry,
  loadPersistedLedgerEntries,
} from "../persistence/append-ledger-entry.js";
import { createBackgroundJob } from "../jobs/create-background-job.js";
import type { BackgroundJobRecord } from "../jobs/types.js";
import type { RunExecutorPipelineInput } from "../wire-up/types.js";

export function buildJobFromPipelineInput(
  input: RunExecutorPipelineInput,
): BackgroundJobRecord {
  const execution = executeProposal({
    executor_eligibility:  input.eligibility,
    operator_confirmation: true,
    now:                   input.now,
    executed_at:           input.executed_at,
  });

  const intent = invokeHandlerIntent({
    execution,
    capability_handler_id: input.capability_handler_id.trim(),
  });

  const ledgerRecord = appendExecutionLedgerRecord({
    intent,
    actor: input.ledger_actor,
  });

  const store_dir = input.store_dir.trim();
  const existing = loadPersistedLedgerEntries(store_dir);
  const prior = existing.find(
    (entry) => entry.record.ledger_entry_id === ledgerRecord.ledger_entry_id,
  );

  const persisted =
    prior ??
    appendLedgerEntry({
      store_dir,
      record: ledgerRecord,
    });

  return createBackgroundJob({
    persisted,
    job_kind: input.job_kind,
  });
}
