/**
 * Certified executor chain orchestration — fail closed per stage (INV-WIRE-7).
 * No command execution, queue workers, or web UI routes (INV-WIRE-5, INV-WIRE-6, INV-WIRE-8).
 */

import { appendExecutionLedgerRecord } from "../ledger/append-execution-ledger-record.js";
import { executeProposal } from "../runtime/execute-proposal.js";
import { invokeHandlerIntent } from "../handler/invoke-handler-intent.js";
import { appendLedgerEntry } from "../persistence/append-ledger-entry.js";
import { createBackgroundJob } from "../jobs/create-background-job.js";
import { buildApplyFixView } from "../ui/build-apply-fix-view.js";
import type { BackgroundJobKind } from "../jobs/types.js";
import type { RunExecutorPipelineInput } from "./types.js";
import type { ApplyFixViewModel } from "./types.js";
import { WireUpPipelineRejectedError } from "./types.js";

const ALLOWED_JOB_KINDS: readonly BackgroundJobKind[] = [
  "replay_notify",
  "retry_transport",
];

function reject(rejection_cause: string, explain: string): never {
  throw new WireUpPipelineRejectedError(rejection_cause, explain);
}

function validatePipelineInput(input: RunExecutorPipelineInput): void {
  if (input.operator_confirmation !== true) {
    reject(
      "operator_confirmation_required",
      "operator_confirmation must be true before executeProposal().",
    );
  }

  if (input.store_dir.trim().length === 0) {
    reject("store_dir_invalid", "store_dir is required for appendLedgerEntry().");
  }

  if (input.capability_handler_id.trim().length === 0) {
    reject("capability_handler_id_invalid", "capability_handler_id is required.");
  }

  if (input.executed_at.trim().length === 0 || Number.isNaN(Date.parse(input.executed_at))) {
    reject("executed_at_invalid", "executed_at must be a valid ISO timestamp.");
  }

  if (!ALLOWED_JOB_KINDS.includes(input.job_kind)) {
    reject("job_kind_invalid", `Job kind ${input.job_kind} is not allowed.`);
  }

  if (input.ledger_actor.kind !== "operator") {
    reject("ledger_actor_invalid", "ledger_actor.kind must be operator.");
  }

  if (input.ledger_actor.actor_id.trim().length === 0) {
    reject("ledger_actor_invalid", "ledger_actor.actor_id is required.");
  }
}

/**
 * Run the certified executor chain in mandatory order; terminal output is ApplyFixViewModel only.
 */
export function runExecutorPipeline(input: RunExecutorPipelineInput): ApplyFixViewModel {
  validatePipelineInput(input);

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

  const persisted = appendLedgerEntry({
    store_dir: input.store_dir.trim(),
    record:    ledgerRecord,
  });

  const job = createBackgroundJob({
    persisted,
    job_kind: input.job_kind,
  });

  return buildApplyFixView({ job });
}

/** Contract alias — same semantics as `runExecutorPipeline`. */
export const runExecutorApplyFixWireUp = runExecutorPipeline;
