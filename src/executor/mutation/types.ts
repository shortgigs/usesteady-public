/**
 * State mutation runtime types — CommandExecutionRecord gate only.
 * @see docs/product/state-mutation-runtime-contract-v1.md
 */

import type { CommandExecutionRecord } from "../command/types.js";

export type StateMutationScope = {
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly command_class: string;
  readonly target_scope: readonly string[];
};

export type MutationAuthorizationKind = "operator_gate" | "worker_self" | "ui_direct";

export type StateMutationRequest = {
  readonly request_id: string;
  readonly mutation_idempotency_key: string;
  readonly command_record_id: string;
  readonly command_idempotency_key: string;
  readonly handler_result_id: string;
  readonly invocation_record_id: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly actor_id: string;
  readonly reason: string;
  readonly authorization_kind: MutationAuthorizationKind;
  readonly mutation_scope: StateMutationScope;
  readonly prepared_at: string;
  readonly expires_at: string;
  readonly ttl_ms: number;
};

export type StateMutationDecision = "applied" | "denied";

export type MutationApplicationEvidence = {
  readonly mutation_kind: string;
  readonly target_scope: readonly string[];
  readonly application_summary: string;
};

export type StateMutationRecord = {
  readonly mutation_record_id: string;
  readonly mutation_idempotency_key: string;
  readonly request_id: string;
  readonly command_record_id: string;
  readonly command_idempotency_key: string;
  readonly handler_result_id: string;
  readonly invocation_record_id: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly decision: StateMutationDecision;
  readonly actor_id: string;
  readonly mutation_scope: StateMutationScope;
  readonly reason: string;
  readonly applied_at: string;
  readonly expires_at: string;
  readonly denial_cause?: string;
  readonly application?: MutationApplicationEvidence;
  readonly lineage_ref: readonly string[];
};

/** Controlled scope store — in-memory only; not filesystem or entitlement state. */
export type ScopedMutationStore = {
  readonly entries: Readonly<Record<string, string>>;
};

export type ApplyStateMutationInput = {
  readonly command: CommandExecutionRecord;
  readonly request: StateMutationRequest;
  readonly prior_mutations?: readonly StateMutationRecord[];
  readonly scoped_store?: ScopedMutationStore;
  readonly now: Date;
};

export type ApplyStateMutationOutput = {
  readonly record: StateMutationRecord;
  readonly scoped_store?: ScopedMutationStore;
};

export type StateMutationRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class StateMutationRejectedError extends Error implements StateMutationRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "StateMutationRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
