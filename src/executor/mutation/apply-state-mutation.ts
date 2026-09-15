/**
 * State mutation runtime — append-only StateMutationRecord + controlled scoped application.
 * Sole gate entry: CommandExecutionRecord with decision authorized.
 * No worker wiring, no UI paths, no entitlement or billing mutation.
 */

import { lookupCommandByClass } from "../command/command-registry.js";
import type { CommandExecutionRecord, CommandExecutionScope } from "../command/types.js";
import { stateMutationRecordId } from "./mutation-id.js";
import type {
  ApplyStateMutationInput,
  ApplyStateMutationOutput,
  MutationApplicationEvidence,
  ScopedMutationStore,
  StateMutationRecord,
  StateMutationRequest,
  StateMutationScope,
} from "./types.js";

const TERMINAL_DECISIONS = new Set<StateMutationRecord["decision"]>(["applied", "denied"]);

const MUTATION_KIND_BY_COMMAND_CLASS: Readonly<Record<string, string>> = {
  cache_refresh_descriptive:     "scoped_cache_refresh",
  transport_recheck_descriptive: "scoped_transport_recheck",
  env_validate_descriptive:      "scoped_env_validate",
};

type ValidationFailure = {
  readonly ok: false;
  readonly denial_cause: string;
  readonly explain: string;
};

type ValidationSuccess = {
  readonly ok: true;
  readonly mutation_kind: string;
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
  mutation: StateMutationScope,
  command: CommandExecutionScope,
): boolean {
  if (mutation.capability_id.trim() !== command.capability_id.trim()) return false;
  if (mutation.handler_intent_id.trim() !== command.handler_intent_id.trim()) return false;
  if (mutation.command_class.trim() !== command.command_class.trim()) return false;
  return true;
}

function buildLineageRef(
  command: CommandExecutionRecord,
  request: StateMutationRequest,
): readonly string[] {
  return [
    command.command_record_id.trim(),
    command.command_idempotency_key.trim(),
    command.handler_result_id.trim(),
    command.invocation_record_id.trim(),
    command.authority_record_id.trim(),
    request.request_id.trim(),
    request.mutation_idempotency_key.trim(),
  ];
}

function resolveMutationKind(command_class: string): string | undefined {
  const entry = lookupCommandByClass(command_class);
  if (!entry) return undefined;
  return MUTATION_KIND_BY_COMMAND_CLASS[entry.command_class];
}

function validateMutationBinding(scope: StateMutationScope): ValidationResult {
  const commandClass = scope.command_class.trim();
  if (commandClass.length === 0) {
    return failure("mutation_policy_fail_closed", "command_class is required on mutation_scope.");
  }

  const entry = lookupCommandByClass(commandClass);
  if (!entry) {
    return failure("mutation_policy_fail_closed", `Unknown command_class ${commandClass}.`);
  }

  if (entry.capability_id.trim() !== scope.capability_id.trim()) {
    return failure("mutation_policy_fail_closed", "mutation_scope capability_id mismatch.");
  }

  const mutationKind = resolveMutationKind(commandClass);
  if (mutationKind === undefined) {
    return failure(
      "mutation_policy_fail_closed",
      `No mutation binding for command_class ${commandClass}.`,
    );
  }

  return { ok: true, mutation_kind: mutationKind };
}

function validateStateMutation(input: ApplyStateMutationInput): ValidationResult {
  const { command, request, now } = input;

  if (!isNonEmpty(request.mutation_idempotency_key)) {
    return failure("mutation_idempotency_required", "mutation_idempotency_key is required.");
  }

  if (command.decision !== "authorized") {
    return failure("command_not_authorized", "CommandExecutionRecord must be authorized.");
  }

  if (command.command_record_id.trim() !== request.command_record_id.trim()) {
    return failure("lineage_mismatch", "command_record_id does not match request.");
  }

  if (command.command_idempotency_key.trim() !== request.command_idempotency_key.trim()) {
    return failure("lineage_mismatch", "command_idempotency_key does not match request.");
  }

  if (command.handler_result_id.trim() !== request.handler_result_id.trim()) {
    return failure("lineage_mismatch", "handler_result_id does not match request.");
  }

  if (command.invocation_record_id.trim() !== request.invocation_record_id.trim()) {
    return failure("lineage_mismatch", "invocation_record_id does not match request.");
  }

  if (command.authority_record_id.trim() !== request.authority_record_id.trim()) {
    return failure("lineage_mismatch", "authority_record_id does not match request.");
  }

  if (command.job_id.trim() !== request.job_id.trim()) {
    return failure("lineage_mismatch", "job_id does not match request.");
  }

  if (request.authorization_kind !== "operator_gate") {
    if (request.authorization_kind === "worker_self") {
      return failure(
        "worker_self_mutation_authorization",
        "Workers cannot self-authorize state mutation.",
      );
    }
    if (request.authorization_kind === "ui_direct") {
      return failure("ui_direct_mutation_forbidden", "UI cannot mutate state directly.");
    }
    return failure("mutation_authorization_invalid", "operator_gate is required.");
  }

  if (!isNonEmpty(request.actor_id) || !isNonEmpty(request.reason)) {
    return failure(
      "mutation_authorization_incomplete",
      "actor_id and reason are required on StateMutationRequest.",
    );
  }

  if (now.getTime() >= new Date(request.expires_at).getTime()) {
    return failure("mutation_window_expired", "State mutation window is expired.");
  }

  if (!scopeFieldsMatch(request.mutation_scope, command.command_scope)) {
    return failure("scope_widened", "mutation_scope exceeds command scope.");
  }

  if (
    !isScopeSubset(
      normalizeScopePaths(request.mutation_scope.target_scope),
      normalizeScopePaths(command.command_scope.target_scope),
    )
  ) {
    return failure("scope_widened", "mutation target_scope exceeds command target_scope.");
  }

  return validateMutationBinding(request.mutation_scope);
}

function findTerminalByIdempotency(
  prior: readonly StateMutationRecord[],
  mutation_idempotency_key: string,
): StateMutationRecord | undefined {
  const matches = prior.filter(
    (r) =>
      r.mutation_idempotency_key.trim() === mutation_idempotency_key.trim() &&
      TERMINAL_DECISIONS.has(r.decision),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function buildRecord(input: {
  readonly command: CommandExecutionRecord;
  readonly request: StateMutationRequest;
  readonly applied_at: string;
  readonly decision: StateMutationRecord["decision"];
  readonly denial_cause?: string;
  readonly application?: MutationApplicationEvidence;
}): StateMutationRecord {
  const scope = structuredClone(input.request.mutation_scope);
  const mutation_record_id = stateMutationRecordId({
    mutation_idempotency_key: input.request.mutation_idempotency_key,
    request_id:               input.request.request_id,
    command_record_id:        input.command.command_record_id,
    decision:                 input.decision,
    actor_id:                 input.request.actor_id,
    applied_at:               input.applied_at,
  });

  const base: StateMutationRecord = {
    mutation_record_id,
    mutation_idempotency_key: input.request.mutation_idempotency_key,
    request_id:               input.request.request_id,
    command_record_id:        input.command.command_record_id,
    command_idempotency_key:  input.command.command_idempotency_key,
    handler_result_id:        input.command.handler_result_id,
    invocation_record_id:     input.command.invocation_record_id,
    authority_record_id:      input.command.authority_record_id,
    job_id:                   input.command.job_id,
    decision:                 input.decision,
    actor_id:                 input.request.actor_id,
    mutation_scope:           scope,
    reason:                   input.request.reason,
    applied_at:               input.applied_at,
    expires_at:               input.request.expires_at,
    lineage_ref:              buildLineageRef(input.command, input.request),
  };

  if (input.denial_cause !== undefined) {
    return { ...base, denial_cause: input.denial_cause };
  }
  if (input.application !== undefined) {
    return { ...base, application: input.application };
  }
  return base;
}

function applyControlledScopedMutation(input: {
  readonly scope: StateMutationScope;
  readonly mutation_kind: string;
  readonly scoped_store?: ScopedMutationStore;
  readonly applied_at: string;
}): { readonly application: MutationApplicationEvidence; readonly scoped_store?: ScopedMutationStore } {
  const target_scope = normalizeScopePaths(input.scope.target_scope);
  const summary = `Controlled ${input.mutation_kind} at ${input.applied_at} within [${target_scope.join(", ")}]`;

  const application: MutationApplicationEvidence = {
    mutation_kind:        input.mutation_kind,
    target_scope,
    application_summary:  summary,
  };

  if (input.scoped_store === undefined) {
    return { application };
  }

  const nextEntries: Record<string, string> = { ...input.scoped_store.entries };
  for (const path of target_scope) {
    nextEntries[path] = `${input.mutation_kind}@${input.applied_at}`;
  }

  return {
    application,
    scoped_store: { entries: nextEntries },
  };
}

/**
 * Validate authorized command and emit append-only StateMutationRecord.
 * Applies controlled in-scope store updates when scoped_store is provided.
 */
export function applyStateMutation(input: ApplyStateMutationInput): ApplyStateMutationOutput {
  const prior = input.prior_mutations ?? [];
  const applied_at = input.now.toISOString();

  const replay = findTerminalByIdempotency(prior, input.request.mutation_idempotency_key);
  if (replay !== undefined) {
    return { record: replay };
  }

  const validation = validateStateMutation(input);
  if (!validation.ok) {
    return {
      record: buildRecord({
        command:      input.command,
        request:      input.request,
        applied_at,
        decision:     "denied",
        denial_cause: validation.denial_cause,
      }),
    };
  }

  const applied = applyControlledScopedMutation({
    scope:         input.request.mutation_scope,
    mutation_kind: validation.mutation_kind,
    ...(input.scoped_store !== undefined ? { scoped_store: input.scoped_store } : {}),
    applied_at,
  });

  return {
    record: buildRecord({
      command:     input.command,
      request:     input.request,
      applied_at,
      decision:    "applied",
      application: applied.application,
    }),
    ...(applied.scoped_store !== undefined ? { scoped_store: applied.scoped_store } : {}),
  };
}

/**
 * Descriptive replay — prior terminal record if present (no re-apply).
 */
export function replayStateMutation(input: {
  readonly prior_mutations: readonly StateMutationRecord[];
  readonly mutation_idempotency_key: string;
}): StateMutationRecord | undefined {
  return findTerminalByIdempotency(
    input.prior_mutations,
    input.mutation_idempotency_key,
  );
}
