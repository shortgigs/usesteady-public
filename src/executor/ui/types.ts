/**
 * Apply Fix presentation types (read-only — no authority).
 * @see docs/product/apply-fix-ui-contract-v1.md
 */

import type { BackgroundJobKind, BackgroundJobRecord } from "../jobs/types.js";

export type ApplyFixAuthorityKind = "presentation_only";

export type ApplyFixAuthorityNotice = {
  readonly kind: ApplyFixAuthorityKind;
  readonly message: string;
};

export type ApplyFixLineageRow = {
  readonly at: string;
  readonly source: "job" | "ledger" | "handler_intent";
  readonly kind: string;
  readonly execution_id: string;
  readonly ledger_entry_id: string;
  readonly handler_intent_id: string;
  readonly note?: string;
};

/** Read-only projection for Apply Fix surfaces — not an execution authority. */
export type ApplyFixViewModel = {
  readonly view_id: string;
  readonly authority: ApplyFixAuthorityNotice;
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly job_kind: BackgroundJobKind;
  readonly transport_state: "enqueued";
  readonly execution_id: string;
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly ledger_entry_id: string;
  readonly store_sequence: number;
  readonly intent_summary: string;
  readonly target_scope: readonly string[];
  readonly risk_notes: readonly string[];
  readonly actor_id: string;
  readonly recorded_at: string;
  readonly enqueued_at: string;
  readonly payload_hash: string;
  readonly lineage_rows: readonly ApplyFixLineageRow[];
  readonly operator_path_note: string;
};

export type BuildApplyFixViewInput = {
  readonly job: BackgroundJobRecord;
};

export type ApplyFixUiRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class ApplyFixUiRejectedError extends Error implements ApplyFixUiRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ApplyFixUiRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
