/**
 * Authority validation — deny-by-default; no invoke (INV-REXEC-1, INV-REXEC-10).
 */

import type {
  AuthorizationScope,
  AuthorityGrantSource,
  AuthorityScopeEnvelope,
  AuthorityValidationInput,
  AuthorityValidationResult,
  WorkerExecutionRequest,
} from "./types.js";

function failure(
  denial_cause: string,
  explain: string,
): AuthorityValidationResult {
  return { ok: false, denial_cause, explain };
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isRequestIncomplete(request: WorkerExecutionRequest): boolean {
  if (!isNonEmpty(request.request_id)) return true;
  if (!isNonEmpty(request.job_id)) return true;
  if (!isNonEmpty(request.execution_id)) return true;
  if (!isNonEmpty(request.ledger_entry_id)) return true;
  if (!isNonEmpty(request.handler_intent_id)) return true;
  if (!isNonEmpty(request.payload_hash)) return true;
  if (!isNonEmpty(request.prepared_at)) return true;
  return false;
}

function normalizeScopePaths(paths: readonly string[]): readonly string[] {
  return paths.map((p) => p.trim()).filter((p) => p.length > 0);
}

function isScopeSubset(
  requested: readonly string[],
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed.map((p) => p.trim()));
  if (allowedSet.size === 0) return false;
  for (const path of requested) {
    const trimmed = path.trim();
    if (trimmed.length === 0) return false;
    if (!allowedSet.has(trimmed)) return false;
  }
  return requested.length > 0;
}

function scopeMatchesEnvelope(
  scope: AuthorizationScope,
  envelope: AuthorityScopeEnvelope,
): boolean {
  if (scope.capability_id.trim() !== envelope.capability_id.trim()) return false;
  if (scope.handler_intent_id.trim() !== envelope.handler_intent_id.trim()) return false;
  if (scope.job_kind !== envelope.job_kind) return false;
  return isScopeSubset(
    normalizeScopePaths(scope.target_scope),
    normalizeScopePaths(envelope.target_scope),
  );
}

function requestAlignsWithEnvelope(
  request: WorkerExecutionRequest,
  envelope: AuthorityScopeEnvelope,
): boolean {
  if (request.handler_intent_id.trim() !== envelope.handler_intent_id.trim()) return false;
  if (request.job_kind !== envelope.job_kind) return false;
  return true;
}

function isGrantSourceForbidden(source: AuthorityGrantSource): boolean {
  if (source.kind === "worker_self") return true;
  if (source.kind !== "operator_gate") return true;
  if (!isNonEmpty(source.actor_id)) return true;
  return false;
}

/**
 * Validate authority inputs. Fail closed — success does not imply grant until record step.
 */
export function validateAuthority(
  input: AuthorityValidationInput,
): AuthorityValidationResult {
  const { request, actor_id, authorization_scope, reason, allowed_envelope, grant_source } =
    input;

  if (isRequestIncomplete(request)) {
    return failure("request_incomplete", "WorkerExecutionRequest is incomplete.");
  }

  if (!isNonEmpty(actor_id)) {
    return failure("actor_id_required", "actor_id is required for authorization.");
  }

  if (!isNonEmpty(reason)) {
    return failure("reason_required", "reason is required for authorization.");
  }

  if (isGrantSourceForbidden(grant_source)) {
    return failure(
      "worker_self_authorize_forbidden",
      "Workers cannot self-authorize execution authority.",
    );
  }

  if (grant_source.actor_id.trim() !== actor_id.trim()) {
    return failure(
      "grant_source_actor_mismatch",
      "grant_source.actor_id must match validation actor_id.",
    );
  }

  if (!requestAlignsWithEnvelope(request, allowed_envelope)) {
    return failure(
      "request_envelope_mismatch",
      "WorkerExecutionRequest does not align with allowed envelope.",
    );
  }

  if (!scopeMatchesEnvelope(authorization_scope, allowed_envelope)) {
    return failure(
      "scope_widening_forbidden",
      "authorization_scope exceeds least-privilege allowed envelope.",
    );
  }

  return { ok: true };
}
