/**
 * Emit append-only ExecutionAuthorityRecord — no handler invoke (INV-REXEC-0).
 */

import { executionAuthorityRecordId } from "./authority-id.js";
import { AUTHORITY_TTL_MS_BY_JOB_KIND } from "./constants.js";
import { validateAuthority } from "./validate-authority.js";
import type {
  AuthorizationScope,
  CreateExecutionAuthorityRecordInput,
  ExecutionAuthorityRecord,
  WorkerExecutionRequest,
} from "./types.js";

const TERMINAL_DECISIONS = new Set<ExecutionAuthorityRecord["decision"]>([
  "granted",
  "denied",
]);

function isoPlusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function buildLineageRef(request: WorkerExecutionRequest): readonly string[] {
  return [
    request.request_id.trim(),
    request.job_id.trim(),
    request.execution_id.trim(),
    request.ledger_entry_id.trim(),
    request.handler_intent_id.trim(),
    request.payload_hash.trim(),
  ];
}

function findTerminalByIdempotency(
  prior: readonly ExecutionAuthorityRecord[],
  idempotency_key: string,
): ExecutionAuthorityRecord | undefined {
  const matches = prior.filter(
    (r) =>
      r.idempotency_key.trim() === idempotency_key.trim() &&
      TERMINAL_DECISIONS.has(r.decision),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function buildDeniedRecord(input: {
  readonly request: WorkerExecutionRequest;
  readonly idempotency_key: string;
  readonly actor_id: string;
  readonly authorization_scope: AuthorizationScope;
  readonly reason: string;
  readonly decided_at: string;
  readonly denial_cause: string;
}): ExecutionAuthorityRecord {
  const scope = structuredClone(input.authorization_scope);
  const authority_record_id = executionAuthorityRecordId({
    request_id:      input.request.request_id,
    job_id:          input.request.job_id,
    idempotency_key: input.idempotency_key,
    decision:        "denied",
    actor_id:        input.actor_id,
    decided_at:      input.decided_at,
  });

  return {
    authority_record_id,
    request_id:       input.request.request_id,
    job_id:           input.request.job_id,
    idempotency_key:  input.idempotency_key,
    decision:         "denied",
    actor_id:         input.actor_id,
    authorization_scope: scope,
    reason:           input.reason,
    decided_at:       input.decided_at,
    expires_at:       input.decided_at,
    ttl_ms:           0,
    denial_cause:     input.denial_cause,
    lineage_ref:      buildLineageRef(input.request),
  };
}

function buildGrantedRecord(input: {
  readonly request: WorkerExecutionRequest;
  readonly idempotency_key: string;
  readonly actor_id: string;
  readonly authorization_scope: AuthorizationScope;
  readonly reason: string;
  readonly decided_at: string;
  readonly ttl_ms: number;
}): ExecutionAuthorityRecord {
  const scope = structuredClone(input.authorization_scope);
  const expires_at = isoPlusMs(input.decided_at, input.ttl_ms);
  const authority_record_id = executionAuthorityRecordId({
    request_id:      input.request.request_id,
    job_id:          input.request.job_id,
    idempotency_key: input.idempotency_key,
    decision:        "granted",
    actor_id:        input.actor_id,
    decided_at:      input.decided_at,
  });

  return {
    authority_record_id,
    request_id:       input.request.request_id,
    job_id:           input.request.job_id,
    idempotency_key:  input.idempotency_key,
    decision:         "granted",
    actor_id:         input.actor_id,
    authorization_scope: scope,
    reason:           input.reason,
    decided_at:       input.decided_at,
    expires_at,
    ttl_ms:           input.ttl_ms,
    lineage_ref:      buildLineageRef(input.request),
  };
}

/**
 * Validate and emit an append-only authority decision record.
 * Deny-by-default (INV-REXEC-1). Idempotent replay returns prior terminal record.
 */
export function createExecutionAuthorityRecord(
  input: CreateExecutionAuthorityRecordInput,
): ExecutionAuthorityRecord {
  const prior = input.prior_records ?? [];
  const { validation, idempotency_key } = input;
  const decided_at = input.now.toISOString();

  const replay = findTerminalByIdempotency(prior, idempotency_key);
  if (replay !== undefined) {
    return replay;
  }

  const result = validateAuthority(validation);
  const request = validation.request;
  const scope = validation.authorization_scope;

  if (!result.ok) {
    return buildDeniedRecord({
      request,
      idempotency_key,
      actor_id: validation.actor_id,
      authorization_scope: scope,
      reason: validation.reason,
      decided_at,
      denial_cause: result.denial_cause,
    });
  }

  const ttl_ms = AUTHORITY_TTL_MS_BY_JOB_KIND[request.job_kind];
  if (!Number.isFinite(ttl_ms) || ttl_ms <= 0) {
    return buildDeniedRecord({
      request,
      idempotency_key,
      actor_id: validation.actor_id,
      authorization_scope: scope,
      reason: validation.reason,
      decided_at,
      denial_cause: "ttl_policy_missing",
    });
  }

  return buildGrantedRecord({
    request,
    idempotency_key,
    actor_id: validation.actor_id,
    authorization_scope: scope,
    reason: validation.reason,
    decided_at,
    ttl_ms,
  });
}

/**
 * Descriptive replay — returns prior terminal record if present (no re-authorize).
 */
export function replayExecutionAuthorityRecord(input: {
  readonly prior_records: readonly ExecutionAuthorityRecord[];
  readonly idempotency_key: string;
}): ExecutionAuthorityRecord | undefined {
  return findTerminalByIdempotency(input.prior_records, input.idempotency_key);
}

/**
 * Returns false when a granted record is expired at `now` (invoke still blocked elsewhere).
 */
export function isExecutionAuthorityExpired(
  record: ExecutionAuthorityRecord,
  now: Date,
): boolean {
  if (record.decision !== "granted") return false;
  return now.getTime() >= new Date(record.expires_at).getTime();
}
