/**
 * Real handler invocation — append-only records only (INV-RHAND-1..10).
 * No command runtime, no filesystem mutation, no state mutation.
 */

import { isExecutionAuthorityExpired } from "../authority/create-execution-authority-record.js";
import type { AuthorizationScope, ExecutionAuthorityRecord } from "../authority/types.js";
import {
  handlerIntentId,
  lookupHandlerById,
  lookupHandlersForCapability,
} from "../handler/index.js";
import { persistedEntryPayloadHash } from "../jobs/job-id.js";
import type { BackgroundJobRecord } from "../jobs/types.js";
import {
  handlerExecutionResultRecordId,
  handlerInvocationRecordId,
} from "./invocation-id.js";
import type {
  HandlerExecutionResultRecord,
  HandlerInvocationRecord,
  InvokeRealHandlerInput,
  InvokeRealHandlerOutput,
} from "./types.js";

const TERMINAL_INVOCATION = new Set<HandlerInvocationRecord["decision"]>([
  "invoked",
  "denied",
]);

type ValidationFailure = {
  readonly ok: false;
  readonly denial_cause: string;
  readonly explain: string;
};

type ValidationSuccess = {
  readonly ok: true;
  readonly handler_summary: string;
};

type ValidationResult = ValidationFailure | ValidationSuccess;

function failure(denial_cause: string, explain: string): ValidationFailure {
  return { ok: false, denial_cause, explain };
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
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

function buildLineageRef(job: BackgroundJobRecord, authority: ExecutionAuthorityRecord): readonly string[] {
  return [
    job.job_id.trim(),
    job.execution_id.trim(),
    job.payload_hash.trim(),
    authority.authority_record_id.trim(),
    authority.request_id.trim(),
  ];
}

function isJobIncomplete(job: BackgroundJobRecord): boolean {
  if (job.transport_state !== "enqueued") return true;
  if (!isNonEmpty(job.job_id)) return true;
  if (!isNonEmpty(job.idempotency_key)) return true;
  if (!isNonEmpty(job.execution_id)) return true;
  if (!isNonEmpty(job.handler_intent_id)) return true;
  if (!isNonEmpty(job.capability_id)) return true;
  if (!isNonEmpty(job.payload_hash)) return true;
  if (job.lineage.length === 0) return true;
  const expectedHash = persistedEntryPayloadHash(job.persisted_entry);
  if (job.payload_hash.trim() !== expectedHash) return true;
  const record = job.persisted_entry.record;
  if (record.execution_id.trim() !== job.execution_id.trim()) return true;
  if (record.handler_intent_id.trim() !== job.handler_intent_id.trim()) return true;
  return false;
}

function jobAlignsWithAuthorityScope(
  job: BackgroundJobRecord,
  scope: AuthorizationScope,
): boolean {
  if (job.capability_id.trim() !== scope.capability_id.trim()) return false;
  if (job.handler_intent_id.trim() !== scope.handler_intent_id.trim()) return false;
  if (job.job_kind !== scope.job_kind) return false;
  return true;
}

function validateHandlerBinding(job: BackgroundJobRecord): ValidationResult {
  const handlers = lookupHandlersForCapability(job.capability_id);
  if (handlers.length === 0) {
    return failure("capability_unbound", `No handler binding for capability ${job.capability_id}.`);
  }
  if (handlers.length > 1) {
    return failure(
      "handler_policy_fail_closed",
      `Ambiguous handler binding for capability ${job.capability_id}.`,
    );
  }

  const entry = handlers[0]!;
  const expectedIntentId = handlerIntentId({
    execution_id:          job.execution_id,
    capability_id:         job.capability_id,
    capability_handler_id: entry.capability_handler_id,
    intent_summary:        entry.intent_summary,
  });

  if (job.handler_intent_id.trim() !== expectedIntentId) {
    return failure(
      "handler_policy_fail_closed",
      "Job handler_intent_id does not match registered handler binding.",
    );
  }

  const registryEntry = lookupHandlerById(entry.capability_handler_id);
  if (!registryEntry) {
    return failure("handler_unregistered", "Handler is not registered.");
  }

  if (
    job.persisted_entry.record.intent_snapshot.handler_intent_id.trim() !==
    job.handler_intent_id.trim()
  ) {
    return failure("lineage_mismatch", "Persisted intent does not match job handler_intent_id.");
  }

  if (
    !isScopeSubset(
      normalizeScopePaths(registryEntry.target_scope),
      normalizeScopePaths(job.persisted_entry.record.intent_snapshot.target_scope),
    )
  ) {
    return failure("handler_policy_fail_closed", "Registry scope does not align with ledger intent.");
  }

  return { ok: true, handler_summary: entry.intent_summary };
}

function validateInvocation(input: InvokeRealHandlerInput): ValidationResult {
  const { job, authority, invocation_idempotency_key, now } = input;

  if (!isNonEmpty(invocation_idempotency_key)) {
    return failure(
      "invocation_idempotency_required",
      "invocation_idempotency_key is required.",
    );
  }

  if (!isNonEmpty(authority.authority_record_id)) {
    return failure("authority_record_incomplete", "authority_record_id is required.");
  }

  if (isJobIncomplete(job)) {
    return failure("job_record_incomplete", "BackgroundJobRecord is incomplete or invalid.");
  }

  if (authority.decision !== "granted") {
    return failure("authority_not_granted", "ExecutionAuthorityRecord must be granted.");
  }

  if (isExecutionAuthorityExpired(authority, now)) {
    return failure("authority_expired", "ExecutionAuthorityRecord is expired at invoke time.");
  }

  if (job.job_id.trim() !== authority.job_id.trim()) {
    return failure("lineage_mismatch", "job_id does not match authority record.");
  }

  if (job.idempotency_key.trim() !== authority.idempotency_key.trim()) {
    return failure("idempotency_mismatch", "job idempotency_key does not match authority.");
  }

  if (!jobAlignsWithAuthorityScope(job, authority.authorization_scope)) {
    return failure("scope_widened", "Job fields exceed granted authorization_scope.");
  }

  const registry = validateHandlerBinding(job);
  if (!registry.ok) {
    return registry;
  }

  const scope = authority.authorization_scope;
  const handlerEntry = lookupHandlersForCapability(job.capability_id)[0]!;
  if (
    !isScopeSubset(
      normalizeScopePaths(handlerEntry.target_scope),
      normalizeScopePaths(scope.target_scope),
    )
  ) {
    return failure("scope_widened", "Handler target_scope exceeds granted authorization_scope.");
  }

  return registry;
}

function findTerminalInvocation(
  prior: readonly HandlerInvocationRecord[],
  invocation_idempotency_key: string,
): HandlerInvocationRecord | undefined {
  const matches = prior.filter(
    (r) =>
      r.invocation_idempotency_key.trim() === invocation_idempotency_key.trim() &&
      TERMINAL_INVOCATION.has(r.decision),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function findResultForInvocation(
  prior: readonly HandlerExecutionResultRecord[],
  invocation_record_id: string,
): HandlerExecutionResultRecord | undefined {
  const matches = prior.filter(
    (r) => r.invocation_record_id.trim() === invocation_record_id.trim(),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function buildInvocationRecord(input: {
  readonly job: BackgroundJobRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly invocation_idempotency_key: string;
  readonly invoked_at: string;
  readonly decision: HandlerInvocationRecord["decision"];
  readonly denial_cause?: string;
}): HandlerInvocationRecord {
  const scope = structuredClone(input.authority.authorization_scope);
  const invocation_record_id = handlerInvocationRecordId({
    invocation_idempotency_key: input.invocation_idempotency_key,
    authority_record_id:        input.authority.authority_record_id,
    job_id:                     input.job.job_id,
    decision:                   input.decision,
    invoked_at:                 input.invoked_at,
  });

  const base: HandlerInvocationRecord = {
    invocation_record_id,
    invocation_idempotency_key: input.invocation_idempotency_key,
    authority_record_id:        input.authority.authority_record_id,
    job_id:                     input.job.job_id,
    request_id:                 input.authority.request_id,
    execution_id:               input.job.execution_id,
    handler_intent_id:          input.job.handler_intent_id,
    capability_id:              input.job.capability_id,
    decision:                   input.decision,
    invoked_at:                 input.invoked_at,
    authorization_scope:        scope,
    lineage_ref:                buildLineageRef(input.job, input.authority),
  };

  if (input.denial_cause !== undefined) {
    return { ...base, denial_cause: input.denial_cause };
  }
  return base;
}

function buildResultRecord(input: {
  readonly invocation: HandlerInvocationRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly job: BackgroundJobRecord;
  readonly recorded_at: string;
  readonly outcome: HandlerExecutionResultRecord["outcome"];
  readonly result_summary: string;
  readonly error_cause?: string;
}): HandlerExecutionResultRecord {
  const result_record_id = handlerExecutionResultRecordId({
    invocation_record_id: input.invocation.invocation_record_id,
    outcome:                input.outcome,
    recorded_at:            input.recorded_at,
  });

  const base: HandlerExecutionResultRecord = {
    result_record_id,
    invocation_record_id: input.invocation.invocation_record_id,
    authority_record_id:  input.authority.authority_record_id,
    job_id:               input.job.job_id,
    outcome:              input.outcome,
    result_summary:       input.result_summary,
    recorded_at:          input.recorded_at,
    lineage_ref:          buildLineageRef(input.job, input.authority),
  };

  if (input.error_cause !== undefined) {
    return { ...base, error_cause: input.error_cause };
  }
  return base;
}

function deniedOutput(
  input: InvokeRealHandlerInput,
  denial_cause: string,
  explain: string,
): InvokeRealHandlerOutput {
  const invoked_at = input.now.toISOString();
  const invocation = buildInvocationRecord({
    job:                        input.job,
    authority:                  input.authority,
    invocation_idempotency_key: input.invocation_idempotency_key,
    invoked_at,
    decision:                   "denied",
    denial_cause,
  });
  const result = buildResultRecord({
    invocation,
    authority:      input.authority,
    job:            input.job,
    recorded_at:    invoked_at,
    outcome:        "blocked",
    result_summary: explain,
    error_cause:    denial_cause,
  });
  return { invocation, result };
}

/**
 * Validate authority + job, emit append-only invocation and result records.
 * Deny-by-default (INV-RHAND-1). No command execution (contract STOP).
 */
export function invokeRealHandler(input: InvokeRealHandlerInput): InvokeRealHandlerOutput {
  const priorInvocations = input.prior_invocations ?? [];
  const priorResults = input.prior_results ?? [];
  const invoked_at = input.now.toISOString();

  const replayInvocation = findTerminalInvocation(
    priorInvocations,
    input.invocation_idempotency_key,
  );
  if (replayInvocation !== undefined) {
    const replayResult = findResultForInvocation(
      priorResults,
      replayInvocation.invocation_record_id,
    );
    if (replayResult !== undefined) {
      return { invocation: replayInvocation, result: replayResult };
    }
  }

  const validation = validateInvocation(input);
  if (!validation.ok) {
    return deniedOutput(input, validation.denial_cause, validation.explain);
  }

  const invocation = buildInvocationRecord({
    job:                        input.job,
    authority:                  input.authority,
    invocation_idempotency_key: input.invocation_idempotency_key,
    invoked_at,
    decision:                   "invoked",
  });

  const result = buildResultRecord({
    invocation,
    authority:      input.authority,
    job:            input.job,
    recorded_at:    invoked_at,
    outcome:        "completed",
    result_summary: `${validation.handler_summary} (real invoke record only — no mutation)`,
  });

  return { invocation, result };
}

/**
 * Descriptive replay — prior terminal invocation + result if present (no re-invoke).
 */
export function replayHandlerInvocation(input: {
  readonly prior_invocations: readonly HandlerInvocationRecord[];
  readonly prior_results: readonly HandlerExecutionResultRecord[];
  readonly invocation_idempotency_key: string;
}): InvokeRealHandlerOutput | undefined {
  const invocation = findTerminalInvocation(
    input.prior_invocations,
    input.invocation_idempotency_key,
  );
  if (invocation === undefined) return undefined;
  const result = findResultForInvocation(
    input.prior_results,
    invocation.invocation_record_id,
  );
  if (result === undefined) return undefined;
  return { invocation, result };
}
