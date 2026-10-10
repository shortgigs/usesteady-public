/**
 * Real execution authority types — decision records only (no invoke).
 * @see docs/product/real-execution-authority-contract-v1.md
 */

import type { BackgroundJobKind } from "../jobs/types.js";

/** Preparatory bundle from queue worker contract — not permission to mutate. */
export type WorkerExecutionRequest = {
  readonly request_id: string;
  readonly job_id: string;
  readonly execution_id: string;
  readonly ledger_entry_id: string;
  readonly handler_intent_id: string;
  readonly job_kind: BackgroundJobKind;
  readonly payload_hash: string;
  readonly prepared_at: string;
  readonly note: string;
};

export type AuthorizationScope = {
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly target_scope: readonly string[];
  readonly job_kind: BackgroundJobKind;
};

/** Max envelope from upstream job/ledger — requested scope must be a subset. */
export type AuthorityScopeEnvelope = {
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly target_scope: readonly string[];
  readonly job_kind: BackgroundJobKind;
};

export type AuthorityGrantSourceKind = "operator_gate" | "worker_self";

export type AuthorityGrantSource = {
  readonly kind: AuthorityGrantSourceKind;
  readonly actor_id: string;
};

export type ExecutionAuthorizationDecision = "granted" | "denied";

export type ExecutionAuthorityRecord = {
  readonly authority_record_id: string;
  readonly request_id: string;
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly decision: ExecutionAuthorizationDecision;
  readonly actor_id: string;
  readonly authorization_scope: AuthorizationScope;
  readonly reason: string;
  readonly decided_at: string;
  readonly expires_at: string;
  readonly ttl_ms: number;
  readonly denial_cause?: string;
  readonly lineage_ref: readonly string[];
};

export type AuthorityValidationInput = {
  readonly request: WorkerExecutionRequest;
  readonly actor_id: string;
  readonly authorization_scope: AuthorizationScope;
  readonly reason: string;
  readonly allowed_envelope: AuthorityScopeEnvelope;
  readonly grant_source: AuthorityGrantSource;
};

export type CreateExecutionAuthorityRecordInput = {
  readonly validation: AuthorityValidationInput;
  readonly idempotency_key: string;
  readonly now: Date;
  /** Append-only prior decisions for idempotent replay (INV-REXEC-5, INV-REXEC-9). */
  readonly prior_records?: readonly ExecutionAuthorityRecord[];
};

export type AuthorityValidationSuccess = {
  readonly ok: true;
};

export type AuthorityValidationFailure = {
  readonly ok: false;
  readonly denial_cause: string;
  readonly explain: string;
};

export type AuthorityValidationResult =
  | AuthorityValidationSuccess
  | AuthorityValidationFailure;

export type AuthorityRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class AuthorityRejectedError extends Error implements AuthorityRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "AuthorityRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
