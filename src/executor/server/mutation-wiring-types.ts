/**
 * UI mutation authorization HTTP DTOs (request acceptance only).
 * @see docs/product/executor-ui-mutation-authorization-contract-v1.md
 */

export type MutationIntentRequestBody = {
  readonly intent: {
    readonly intent_idempotency_key: string;
    readonly job_id: string;
    readonly capability_id: string;
    readonly target_scope: readonly string[];
    readonly mutation_summary: string;
    readonly lineage_ref: readonly string[];
    readonly requested_at: string;
    readonly presentation_surface: "react_apply_fix";
  };
  readonly allowed_envelope: {
    readonly capability_id: string;
    readonly handler_intent_id: string;
    readonly target_scope: readonly string[];
    readonly job_kind: "replay_notify" | "retry_transport";
  };
};

export type MutationIntentSuccessBody = {
  readonly ok: true;
  readonly intent_idempotency_key: string;
  readonly validated_intent: MutationIntentRequestBody["intent"];
  readonly idempotent_replay?: boolean;
};

export type MutationAuthorizationRequestBody = {
  readonly authorization_request: {
    readonly authorization_request_id: string;
    readonly intent_idempotency_key: string;
    readonly validated_intent: MutationIntentRequestBody["intent"];
    readonly actor_id: string;
    readonly operator_confirmation: true;
    readonly confirmation_at: string;
    readonly scope_envelope: MutationIntentRequestBody["allowed_envelope"];
    readonly lineage_ref: readonly string[];
  };
};

export type MutationAuthorizationSuccessBody = {
  readonly ok: true;
  readonly accepted: true;
  readonly authorization_request_id: string;
  readonly intent_idempotency_key: string;
  readonly note: string;
  readonly idempotent_replay?: boolean;
};
