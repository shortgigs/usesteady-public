/**
 * Real command execution — append-only CommandExecutionRecord only (INV-RCMD-1..10).
 * No state mutation runtime, no filesystem mutation.
 */

import { isExecutionAuthorityExpired } from "../authority/create-execution-authority-record.js";
import type { AuthorizationScope, ExecutionAuthorityRecord } from "../authority/types.js";
import type {
  HandlerExecutionResultRecord,
  HandlerInvocationRecord,
} from "../handler-invoke/types.js";
import { lookupCommandByClass, lookupCommandsForCapability } from "./command-registry.js";
import { commandExecutionRecordId } from "./command-id.js";
import type {
  CommandExecutionRecord,
  CommandExecutionRequest,
  CommandExecutionScope,
  ExecuteCommandInput,
} from "./types.js";

const TERMINAL_DECISIONS = new Set<CommandExecutionRecord["decision"]>([
  "authorized",
  "denied",
]);

type ValidationFailure = {
  readonly ok: false;
  readonly denial_cause: string;
  readonly explain: string;
};

type ValidationSuccess = {
  readonly ok: true;
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

function scopeFieldsMatch(
  command: CommandExecutionScope,
  authority: AuthorizationScope,
): boolean {
  if (command.capability_id.trim() !== authority.capability_id.trim()) return false;
  if (command.handler_intent_id.trim() !== authority.handler_intent_id.trim()) return false;
  return true;
}

function buildLineageRef(input: {
  readonly handler_result: HandlerExecutionResultRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly invocation: HandlerInvocationRecord;
  readonly request: CommandExecutionRequest;
}): readonly string[] {
  return [
    input.handler_result.result_record_id.trim(),
    input.invocation.invocation_record_id.trim(),
    input.authority.authority_record_id.trim(),
    input.request.request_id.trim(),
    input.request.command_idempotency_key.trim(),
  ];
}

function validateCommandBinding(scope: CommandExecutionScope): ValidationResult {
  const commandClass = scope.command_class.trim();
  if (commandClass.length === 0) {
    return failure("command_policy_fail_closed", "command_class is required.");
  }

  const entry = lookupCommandByClass(commandClass);
  if (!entry) {
    return failure("command_policy_fail_closed", `Unknown command_class ${commandClass}.`);
  }

  const bindings = lookupCommandsForCapability(scope.capability_id);
  if (bindings.length === 0) {
    return failure("command_policy_fail_closed", `No command binding for ${scope.capability_id}.`);
  }

  const allowed = bindings.filter((b) => b.command_class === entry.command_class);
  if (allowed.length !== 1) {
    return failure(
      "command_policy_fail_closed",
      `Ambiguous command binding for capability ${scope.capability_id}.`,
    );
  }

  if (entry.capability_id.trim() !== scope.capability_id.trim()) {
    return failure("command_policy_fail_closed", "command_scope capability_id mismatch.");
  }

  return { ok: true };
}

function validateCommandExecution(input: ExecuteCommandInput): ValidationResult {
  const { handler_result, authority, invocation, request, now } = input;

  if (!isNonEmpty(request.command_idempotency_key)) {
    return failure("command_idempotency_required", "command_idempotency_key is required.");
  }

  if (handler_result.outcome !== "completed") {
    return failure("handler_not_completed", "Handler result must be completed.");
  }

  if (invocation.decision !== "invoked") {
    return failure("handler_not_completed", "Handler invocation must be invoked.");
  }

  if (handler_result.result_record_id.trim() !== request.handler_result_id.trim()) {
    return failure("lineage_mismatch", "handler_result_id does not match request.");
  }

  if (handler_result.invocation_record_id.trim() !== request.invocation_record_id.trim()) {
    return failure("lineage_mismatch", "invocation_record_id does not match request.");
  }

  if (handler_result.authority_record_id.trim() !== request.authority_record_id.trim()) {
    return failure("lineage_mismatch", "authority_record_id does not match request.");
  }

  if (handler_result.job_id.trim() !== request.job_id.trim()) {
    return failure("lineage_mismatch", "job_id does not match request.");
  }

  if (invocation.invocation_record_id.trim() !== request.invocation_record_id.trim()) {
    return failure("lineage_mismatch", "invocation record does not match request.");
  }

  if (authority.authority_record_id.trim() !== request.authority_record_id.trim()) {
    return failure("lineage_mismatch", "authority record does not match request.");
  }

  if (authority.job_id.trim() !== request.job_id.trim()) {
    return failure("lineage_mismatch", "authority job_id does not match request.");
  }

  if (authority.decision !== "granted") {
    return failure("authority_not_granted", "ExecutionAuthorityRecord must be granted.");
  }

  if (isExecutionAuthorityExpired(authority, now)) {
    return failure("authority_expired", "ExecutionAuthorityRecord is expired.");
  }

  if (request.authorization_kind === "worker_self") {
    return failure(
      "worker_self_command_authorization",
      "Workers cannot self-authorize command execution.",
    );
  }

  if (!isNonEmpty(request.actor_id) || !isNonEmpty(request.reason)) {
    return failure(
      "command_authorization_incomplete",
      "actor_id and reason are required on CommandExecutionRequest.",
    );
  }

  if (now.getTime() >= new Date(request.expires_at).getTime()) {
    return failure("command_window_expired", "Command execution window is expired.");
  }

  if (!scopeFieldsMatch(request.command_scope, authority.authorization_scope)) {
    return failure("scope_widened", "command_scope exceeds authority scope.");
  }

  if (
    !isScopeSubset(
      normalizeScopePaths(request.command_scope.target_scope),
      normalizeScopePaths(authority.authorization_scope.target_scope),
    )
  ) {
    return failure("scope_widened", "command target_scope exceeds authority target_scope.");
  }

  if (
    !isScopeSubset(
      normalizeScopePaths(request.command_scope.target_scope),
      normalizeScopePaths(invocation.authorization_scope.target_scope),
    )
  ) {
    return failure("scope_widened", "command target_scope exceeds invocation scope.");
  }

  return validateCommandBinding(request.command_scope);
}

function findTerminalByIdempotency(
  prior: readonly CommandExecutionRecord[],
  command_idempotency_key: string,
): CommandExecutionRecord | undefined {
  const matches = prior.filter(
    (r) =>
      r.command_idempotency_key.trim() === command_idempotency_key.trim() &&
      TERMINAL_DECISIONS.has(r.decision),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function buildRecord(input: {
  readonly handler_result: HandlerExecutionResultRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly invocation: HandlerInvocationRecord;
  readonly request: CommandExecutionRequest;
  readonly decided_at: string;
  readonly decision: CommandExecutionRecord["decision"];
  readonly denial_cause?: string;
}): CommandExecutionRecord {
  const scope = structuredClone(input.request.command_scope);
  const command_record_id = commandExecutionRecordId({
    command_idempotency_key: input.request.command_idempotency_key,
    request_id:            input.request.request_id,
    handler_result_id:     input.handler_result.result_record_id,
    decision:              input.decision,
    actor_id:              input.request.actor_id,
    decided_at:            input.decided_at,
  });

  const base: CommandExecutionRecord = {
    command_record_id,
    command_idempotency_key: input.request.command_idempotency_key,
    request_id:            input.request.request_id,
    handler_result_id:     input.handler_result.result_record_id,
    invocation_record_id:  input.invocation.invocation_record_id,
    authority_record_id:   input.authority.authority_record_id,
    job_id:                input.request.job_id,
    decision:              input.decision,
    actor_id:              input.request.actor_id,
    command_scope:         scope,
    reason:                input.request.reason,
    decided_at:            input.decided_at,
    expires_at:            input.request.expires_at,
    lineage_ref:           buildLineageRef(input),
  };

  if (input.denial_cause !== undefined) {
    return { ...base, denial_cause: input.denial_cause };
  }
  return base;
}

/**
 * Validate command path and emit append-only CommandExecutionRecord.
 * Deny-by-default (INV-RCMD-1). No state mutation (contract STOP).
 */
export function executeCommand(input: ExecuteCommandInput): CommandExecutionRecord {
  const prior = input.prior_executions ?? [];
  const decided_at = input.now.toISOString();

  const replay = findTerminalByIdempotency(prior, input.request.command_idempotency_key);
  if (replay !== undefined) {
    return replay;
  }

  const validation = validateCommandExecution(input);
  if (!validation.ok) {
    return buildRecord({
      handler_result: input.handler_result,
      authority:      input.authority,
      invocation:     input.invocation,
      request:        input.request,
      decided_at,
      decision:       "denied",
      denial_cause:   validation.denial_cause,
    });
  }

  return buildRecord({
    handler_result: input.handler_result,
    authority:      input.authority,
    invocation:     input.invocation,
    request:        input.request,
    decided_at,
    decision:       "authorized",
  });
}

/**
 * Descriptive replay — prior terminal record if present (no re-execute).
 */
export function replayCommandExecution(input: {
  readonly prior_executions: readonly CommandExecutionRecord[];
  readonly command_idempotency_key: string;
}): CommandExecutionRecord | undefined {
  return findTerminalByIdempotency(
    input.prior_executions,
    input.command_idempotency_key,
  );
}
