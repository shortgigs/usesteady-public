/**
 * Execution ledger types (append-only record — no durable I/O).
 * @see docs/product/execution-ledger-contract-v1.md
 * @see docs/product/append-execution-ledger-runtime-contract-v1.md
 */

import type { HandlerIntentRecord } from "../handler/types.js";

export type ExecutionLedgerLineageKind = "ledger_appended" | "replay_read";

export type ExecutionLedgerLineageEntry = {
  readonly at: string;
  readonly kind: ExecutionLedgerLineageKind;
  readonly prior_ledger_entry_id?: string;
  readonly note?: string;
};

export type ExecutionLedgerActor = {
  readonly kind: "operator";
  readonly actor_id: string;
};

export type ExecutionLedgerRecord = {
  readonly ledger_entry_id: string;
  readonly handler_intent_id: string;
  readonly execution_id: string;
  readonly capability_id: string;
  readonly actor: ExecutionLedgerActor;
  readonly recorded_at: string;
  readonly intent_snapshot: HandlerIntentRecord;
  readonly lineage: readonly ExecutionLedgerLineageEntry[];
};

export type AppendExecutionLedgerRecordInput = {
  readonly intent: HandlerIntentRecord;
  readonly actor: ExecutionLedgerActor;
  readonly prior_ledger_entry_id?: string;
};

export type ExecutionLedgerRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class ExecutionLedgerRejectedError extends Error implements ExecutionLedgerRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ExecutionLedgerRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
