/**
 * Executor ledger durable persistence types (append-only store).
 * @see docs/product/executor-persistence-contract-v1.md
 */

import type { ExecutionLedgerRecord } from "../ledger/types.js";

/** Durable persisted ledger entry — append order is authoritative for replay. */
export type PersistedLedgerEntry = {
  readonly sequence: number;
  readonly record: ExecutionLedgerRecord;
};

export type AppendLedgerEntryInput = {
  readonly store_dir: string;
  readonly record: ExecutionLedgerRecord;
};

export type ReplayLedgerEntriesInput = {
  readonly store_dir: string;
  readonly execution_id: string;
};

export type PersistenceRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class PersistenceRejectedError extends Error implements PersistenceRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "PersistenceRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
