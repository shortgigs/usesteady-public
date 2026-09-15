/**
 * Pure in-memory ledger append — no durable I/O (INV-LRUNTIME-7, INV-LRUNTIME-8).
 */

import type { HandlerIntentRecord } from "../handler/types.js";
import { ledgerEntryId } from "./ledger-entry-id.js";
import type {
  AppendExecutionLedgerRecordInput,
  ExecutionLedgerActor,
  ExecutionLedgerLineageEntry,
  ExecutionLedgerRecord,
} from "./types.js";
import { ExecutionLedgerRejectedError } from "./types.js";

function reject(rejection_cause: string, explain: string): never {
  throw new ExecutionLedgerRejectedError(rejection_cause, explain);
}

function snapshotIntent(intent: HandlerIntentRecord): HandlerIntentRecord {
  return structuredClone(intent);
}

function isActorInvalid(actor: ExecutionLedgerActor): boolean {
  if (actor.kind !== "operator") return true;
  if (actor.actor_id.trim().length === 0) return true;
  return false;
}

function isIntentIncomplete(intent: HandlerIntentRecord): boolean {
  if (intent.handler_intent_id.trim().length === 0) return true;
  if (intent.execution_id.trim().length === 0) return true;
  if (intent.capability_id.trim().length === 0) return true;
  if (intent.intent_summary.trim().length === 0) return true;
  if (intent.lineage.length === 0) return true;
  return false;
}

function recordedAtFromIntent(intent: HandlerIntentRecord): string {
  const head = intent.lineage[0];
  if (!head || head.at.trim().length === 0) {
    reject("handler_intent_incomplete", "Handler intent lineage head is missing recorded time.");
  }
  return head.at;
}

function buildLedgerLineage(
  recorded_at: string,
  prior_ledger_entry_id: string | undefined,
): readonly ExecutionLedgerLineageEntry[] {
  const entry: ExecutionLedgerLineageEntry = {
    at:   recorded_at,
    kind: "ledger_appended",
    note: "execution ledger entry appended (in-memory record only)",
    ...(prior_ledger_entry_id !== undefined && prior_ledger_entry_id.length > 0
      ? { prior_ledger_entry_id }
      : {}),
  };
  return [entry];
}

export function appendExecutionLedgerRecord(
  input: AppendExecutionLedgerRecordInput,
): ExecutionLedgerRecord {
  const intent = input.intent;

  if (intent.handler_kind !== "descriptive") {
    reject("handler_intent_not_descriptive", "Handler intent must be descriptive.");
  }

  if (isIntentIncomplete(intent)) {
    reject("handler_intent_incomplete", "Handler intent is incomplete.");
  }

  if (isActorInvalid(input.actor)) {
    reject("ledger_actor_invalid", "Ledger actor is invalid.");
  }

  const recorded_at = recordedAtFromIntent(intent);
  const prior = input.prior_ledger_entry_id?.trim();
  const prior_ledger_entry_id =
    prior !== undefined && prior.length > 0 ? prior : undefined;

  const actor: ExecutionLedgerActor = {
    kind:     "operator",
    actor_id: input.actor.actor_id.trim(),
  };

  const intent_snapshot = snapshotIntent(intent);

  return {
    ledger_entry_id: ledgerEntryId({
      handler_intent_id:     intent.handler_intent_id,
      execution_id:          intent.execution_id,
      capability_id:         intent.capability_id,
      actor_id:              actor.actor_id,
      ...(prior_ledger_entry_id !== undefined ? { prior_ledger_entry_id } : {}),
    }),
    handler_intent_id: intent.handler_intent_id,
    execution_id:      intent.execution_id,
    capability_id:     intent.capability_id,
    actor,
    recorded_at,
    intent_snapshot,
    lineage: buildLedgerLineage(recorded_at, prior_ledger_entry_id),
  };
}
