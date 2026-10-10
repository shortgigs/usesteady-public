/**
 * Background job transport types (no execution authority).
 * @see docs/product/executor-background-jobs-contract-v1.md
 */

import type { PersistedLedgerEntry } from "../persistence/types.js";

export type BackgroundJobKind = "replay_notify" | "retry_transport";

export type BackgroundJobLineageKind = "job_created" | "transport_enqueued";

export type BackgroundJobLineageEntry = {
  readonly at: string;
  readonly kind: BackgroundJobLineageKind;
  readonly execution_id: string;
  readonly ledger_entry_id: string;
  readonly handler_intent_id: string;
  readonly note?: string;
};

/** Transport descriptor derived from a persisted ledger entry — not execution authority. */
export type BackgroundJobRecord = {
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly job_kind: BackgroundJobKind;
  readonly execution_id: string;
  readonly handler_intent_id: string;
  readonly ledger_entry_id: string;
  readonly capability_id: string;
  readonly store_sequence: number;
  readonly payload_hash: string;
  readonly enqueued_at: string;
  readonly transport_state: "enqueued";
  readonly persisted_entry: PersistedLedgerEntry;
  readonly lineage: readonly BackgroundJobLineageEntry[];
};

export type CreateBackgroundJobInput = {
  readonly persisted: PersistedLedgerEntry;
  readonly job_kind: BackgroundJobKind;
};

export type BackgroundJobRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class BackgroundJobsRejectedError extends Error implements BackgroundJobRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "BackgroundJobsRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
