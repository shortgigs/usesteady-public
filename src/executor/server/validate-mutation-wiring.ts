/**
 * Fail-closed validation for UI mutation authorization requests (no mint, no invoke).
 */

import { ExecutorRouteRejectedError } from "./types.js";
import type {
  MutationAuthorizationRequestBody,
  MutationIntentRequestBody,
} from "./mutation-wiring-types.js";

function nonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      `${field} must be a non-empty string.`,
    );
  }
}

function normalizeScope(scope: readonly string[]): readonly string[] {
  return scope.map((s) => s.trim()).filter((s) => s.length > 0);
}

function isSubset(
  requested: readonly string[],
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed.map((s) => s.trim()));
  return requested.every((s) => allowedSet.has(s.trim()));
}

export function validateMutationIntentBody(
  body: unknown,
): MutationIntentRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "Body must be an object.");
  }
  const o = body as Record<string, unknown>;
  const intent = o["intent"];
  const allowed_envelope = o["allowed_envelope"];
  if (typeof intent !== "object" || intent === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "intent is required.");
  }
  if (typeof allowed_envelope !== "object" || allowed_envelope === null) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      "allowed_envelope is required.",
    );
  }

  const i = intent as Record<string, unknown>;
  const e = allowed_envelope as Record<string, unknown>;

  nonEmpty(String(i["intent_idempotency_key"] ?? ""), "intent_idempotency_key");
  nonEmpty(String(i["job_id"] ?? ""), "job_id");
  nonEmpty(String(i["capability_id"] ?? ""), "capability_id");
  nonEmpty(String(i["mutation_summary"] ?? ""), "mutation_summary");
  nonEmpty(String(i["requested_at"] ?? ""), "requested_at");

  if (i["presentation_surface"] !== "react_apply_fix") {
    throw new ExecutorRouteRejectedError(
      "presentation_surface_invalid",
      'presentation_surface must be "react_apply_fix".',
    );
  }

  const target_scope = normalizeScope(
    Array.isArray(i["target_scope"]) ? (i["target_scope"] as string[]) : [],
  );
  if (target_scope.length === 0) {
    throw new ExecutorRouteRejectedError(
      "target_scope_empty",
      "intent.target_scope must be non-empty.",
    );
  }

  const envelopeScope = normalizeScope(
    Array.isArray(e["target_scope"]) ? (e["target_scope"] as string[]) : [],
  );
  if (envelopeScope.length === 0) {
    throw new ExecutorRouteRejectedError(
      "target_scope_empty",
      "allowed_envelope.target_scope must be non-empty.",
    );
  }

  const capability_id = String(i["capability_id"]).trim();
  const envelope_capability = String(e["capability_id"] ?? "").trim();
  if (capability_id !== envelope_capability) {
    throw new ExecutorRouteRejectedError(
      "scope_widening_denied",
      "intent.capability_id must match allowed_envelope.capability_id.",
    );
  }

  if (!isSubset(target_scope, envelopeScope)) {
    throw new ExecutorRouteRejectedError(
      "scope_widening_denied",
      "intent.target_scope must be a subset of allowed_envelope.target_scope.",
    );
  }

  const lineage_ref = Array.isArray(i["lineage_ref"])
    ? (i["lineage_ref"] as unknown[]).map(String)
    : [];

  return {
    intent: {
      intent_idempotency_key: String(i["intent_idempotency_key"]).trim(),
      job_id:                 String(i["job_id"]).trim(),
      capability_id,
      target_scope,
      mutation_summary:       String(i["mutation_summary"]).trim(),
      lineage_ref,
      requested_at:           String(i["requested_at"]).trim(),
      presentation_surface:   "react_apply_fix",
    },
    allowed_envelope: {
      capability_id:     envelope_capability,
      handler_intent_id: String(e["handler_intent_id"] ?? "").trim(),
      target_scope:      envelopeScope,
      job_kind:
        e["job_kind"] === "retry_transport" ? "retry_transport" : "replay_notify",
    },
  };
}

export function validateMutationAuthorizationBody(
  body: unknown,
): MutationAuthorizationRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ExecutorRouteRejectedError("request_incomplete", "Body must be an object.");
  }
  const o = body as Record<string, unknown>;
  const authorization_request = o["authorization_request"];
  if (typeof authorization_request !== "object" || authorization_request === null) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      "authorization_request is required.",
    );
  }

  const r = authorization_request as Record<string, unknown>;
  if (r["operator_confirmation"] !== true) {
    throw new ExecutorRouteRejectedError(
      "operator_confirmation_required",
      "operator_confirmation must be true.",
    );
  }

  nonEmpty(String(r["authorization_request_id"] ?? ""), "authorization_request_id");
  nonEmpty(String(r["intent_idempotency_key"] ?? ""), "intent_idempotency_key");
  nonEmpty(String(r["actor_id"] ?? ""), "actor_id");
  nonEmpty(String(r["confirmation_at"] ?? ""), "confirmation_at");

  const validated_intent = r["validated_intent"];
  const scope_envelope = r["scope_envelope"];
  if (typeof validated_intent !== "object" || validated_intent === null) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      "validated_intent is required.",
    );
  }
  if (typeof scope_envelope !== "object" || scope_envelope === null) {
    throw new ExecutorRouteRejectedError(
      "request_incomplete",
      "scope_envelope is required.",
    );
  }

  const wrapped: MutationIntentRequestBody = {
    intent: validated_intent as MutationIntentRequestBody["intent"],
    allowed_envelope: scope_envelope as MutationIntentRequestBody["allowed_envelope"],
  };
  validateMutationIntentBody(wrapped);

  const intentKey = String(r["intent_idempotency_key"]).trim();
  if (intentKey !== wrapped.intent.intent_idempotency_key) {
    throw new ExecutorRouteRejectedError(
      "intent_key_mismatch",
      "authorization_request.intent_idempotency_key must match validated_intent.",
    );
  }

  const lineage_ref = Array.isArray(r["lineage_ref"])
    ? (r["lineage_ref"] as unknown[]).map(String)
    : [];

  return {
    authorization_request: {
      authorization_request_id: String(r["authorization_request_id"]).trim(),
      intent_idempotency_key:     intentKey,
      validated_intent:         wrapped.intent,
      actor_id:                   String(r["actor_id"]).trim(),
      operator_confirmation:      true,
      confirmation_at:            String(r["confirmation_at"]).trim(),
      scope_envelope:             wrapped.allowed_envelope,
      lineage_ref,
    },
  };
}
