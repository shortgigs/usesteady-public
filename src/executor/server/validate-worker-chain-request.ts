/**
 * Fail-closed validation for UI worker chain intake (orchestration gate only).
 */

import { ExecutorRouteRejectedError } from "./types.js";
import type { UiChainIntakeRequestBody } from "./worker-chain-types.js";
import {
  isAuthorizationAccepted,
  isIntentValidated,
} from "./mutation-wiring-route.js";

const ALLOWED_JOB_KINDS = new Set(["replay_notify", "retry_transport"]);

function nonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      `${field} must be a non-empty string.`,
    );
  }
}

export function validateUiChainIntakeBody(body: unknown): UiChainIntakeRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "Body must be an object.");
  }
  const o = body as Record<string, unknown>;

  if (o["operator_mint_confirmation"] !== true) {
    throw new ExecutorRouteRejectedError(
      "operator_confirmation_required",
      "operator_mint_confirmation must be true before server intake.",
    );
  }

  const authorization_request = o["authorization_request"];
  if (typeof authorization_request !== "object" || authorization_request === null) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      "authorization_request is required.",
    );
  }
  const auth = authorization_request as Record<string, unknown>;
  nonEmpty(String(auth["authorization_request_id"] ?? ""), "authorization_request_id");
  nonEmpty(String(auth["intent_idempotency_key"] ?? ""), "intent_idempotency_key");
  if (auth["operator_confirmation"] !== true) {
    throw new ExecutorRouteRejectedError(
      "operator_confirmation_required",
      "authorization_request.operator_confirmation must be true.",
    );
  }

  const authId = String(auth["authorization_request_id"]).trim();
  if (!isAuthorizationAccepted(authId)) {
    throw new ExecutorRouteRejectedError(
      "authorization_not_accepted",
      "authorization_request must be accepted on the mutation authorization path first.",
    );
  }

  const intentKey = String(auth["intent_idempotency_key"]).trim();
  if (!isIntentValidated(intentKey)) {
    throw new ExecutorRouteRejectedError(
      "intent_not_validated",
      "intent_idempotency_key must be validated on the mutation intent path first.",
    );
  }

  const pipeline = o["pipeline"];
  if (typeof pipeline !== "object" || pipeline === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "pipeline is required.");
  }
  const p = pipeline as Record<string, unknown>;
  if (p["operator_confirmation"] !== true) {
    throw new ExecutorRouteRejectedError(
      "operator_confirmation_required",
      "pipeline.operator_confirmation must be true.",
    );
  }
  nonEmpty(String(p["capability_handler_id"] ?? ""), "capability_handler_id");
  nonEmpty(String(p["store_dir"] ?? ""), "store_dir");
  nonEmpty(String(p["executed_at"] ?? ""), "executed_at");
  const job_kind = String(p["job_kind"] ?? "");
  if (!ALLOWED_JOB_KINDS.has(job_kind)) {
    throw new ExecutorRouteRejectedError("job_kind_invalid", `job_kind ${job_kind} is not allowed.`);
  }
  const ledger_actor = p["ledger_actor"];
  if (typeof ledger_actor !== "object" || ledger_actor === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "ledger_actor is required.");
  }
  const actor = ledger_actor as Record<string, unknown>;
  if (actor["kind"] !== "operator") {
    throw new ExecutorRouteRejectedError(
      "ledger_actor_invalid",
      "ledger_actor.kind must be operator.",
    );
  }
  nonEmpty(String(actor["actor_id"] ?? ""), "ledger_actor.actor_id");

  if (p["eligibility"] === undefined) {
    throw new ExecutorRouteRejectedError("request_incomplete", "pipeline.eligibility is required.");
  }

  const validated_intent = auth["validated_intent"];
  if (typeof validated_intent !== "object" || validated_intent === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "validated_intent is required.");
  }
  const vi = validated_intent as Record<string, unknown>;
  nonEmpty(String(vi["job_id"] ?? ""), "validated_intent.job_id");

  return {
    authorization_request: authorization_request as UiChainIntakeRequestBody["authorization_request"],
    operator_mint_confirmation: true,
    pipeline: {
      eligibility:           p["eligibility"] as UiChainIntakeRequestBody["pipeline"]["eligibility"],
      operator_confirmation: true,
      capability_handler_id: String(p["capability_handler_id"]).trim(),
      ledger_actor: {
        kind:     "operator",
        actor_id: String(actor["actor_id"]).trim(),
      },
      store_dir:   String(p["store_dir"]).trim(),
      job_kind:    job_kind as UiChainIntakeRequestBody["pipeline"]["job_kind"],
      executed_at: String(p["executed_at"]).trim(),
    },
  };
}
