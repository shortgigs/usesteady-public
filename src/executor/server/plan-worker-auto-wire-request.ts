/**
 * Plan WorkerAutoWireRequest IDs for successful-path chain (planning only — no invoke).
 * Used by server intake before processBackgroundJob delegates to runWorkerAutoWire.
 */

import { commandExecutionRecordId } from "../command/command-id.js";
import { lookupCommandByClass } from "../command/command-registry.js";
import type { CommandExecutionRequest } from "../command/types.js";
import type { ExecutionAuthorityRecord } from "../authority/types.js";
import type { BackgroundJobRecord } from "../jobs/types.js";
import {
  handlerExecutionResultRecordId,
  handlerInvocationRecordId,
} from "../handler-invoke/invocation-id.js";
import type { StateMutationRequest } from "../mutation/types.js";
import type { WorkerAutoWireRequest } from "../worker/types.js";

const COMMAND_TTL_MS = 600_000;
const MUTATION_TTL_MS = 600_000;

function isoPlusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

/**
 * Build operator_gate command/mutation requests with IDs aligned to a successful invoke path.
 */
export function planWorkerAutoWireRequest(input: {
  readonly job: BackgroundJobRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly actor_id: string;
  readonly now: Date;
  readonly target_scope: readonly string[];
}): WorkerAutoWireRequest {
  const invoked_at = input.now.toISOString();
  const chain_idempotency_key = `chain-${input.job.job_id}`;
  const invocation_idempotency_key = `invoke-${input.job.job_id}`;

  const invocation_record_id = handlerInvocationRecordId({
    invocation_idempotency_key,
    authority_record_id: input.authority.authority_record_id,
    job_id:                     input.job.job_id,
    decision:                   "invoked",
    invoked_at,
  });

  const result_record_id = handlerExecutionResultRecordId({
    invocation_record_id,
    outcome:       "completed",
    recorded_at:   invoked_at,
  });

  const capability_id = input.job.capability_id;
  const command_class =
    capability_id === "CAP-001"
      ? "cache_refresh_descriptive"
      : capability_id === "CAP-003"
        ? "env_validate_descriptive"
        : "transport_recheck_descriptive";

  if (lookupCommandByClass(command_class) === undefined) {
    throw new Error(`No command class for capability ${capability_id}`);
  }

  const command_request_id = `cmd-req-${input.job.job_id.slice(0, 12)}`;
  const command_idempotency_key = `cmd-${input.job.job_id}`;
  const command_decided_at = invoked_at;
  const command_record_id = commandExecutionRecordId({
    command_idempotency_key,
    request_id:        command_request_id,
    handler_result_id: result_record_id,
    decision:          "authorized",
    actor_id:            input.actor_id,
    decided_at:          command_decided_at,
  });

  const command_request: CommandExecutionRequest = {
    request_id:               command_request_id,
    command_idempotency_key,
    handler_result_id:        result_record_id,
    invocation_record_id,
    authority_record_id:      input.authority.authority_record_id,
    job_id:                   input.job.job_id,
    actor_id:                 input.actor_id,
    reason:                   "operator approved command (ui chain intake)",
    authorization_kind:       "operator_gate",
    command_scope: {
      capability_id:     input.job.capability_id,
      handler_intent_id: input.job.handler_intent_id,
      command_class,
      target_scope:        input.target_scope,
    },
    prepared_at: invoked_at,
    expires_at:  isoPlusMs(invoked_at, COMMAND_TTL_MS),
    ttl_ms:      COMMAND_TTL_MS,
  };

  const mutation_request_id = `mut-req-${input.job.job_id.slice(0, 12)}`;
  const mutation_idempotency_key = `mut-${input.job.job_id}`;

  const mutation_request: StateMutationRequest = {
    request_id:               mutation_request_id,
    mutation_idempotency_key,
    command_record_id,
    command_idempotency_key,
    handler_result_id:        result_record_id,
    invocation_record_id,
    authority_record_id:      input.authority.authority_record_id,
    job_id:                   input.job.job_id,
    actor_id:                 input.actor_id,
    reason:                   "operator approved mutation (ui chain intake)",
    authorization_kind:       "operator_gate",
    mutation_scope: {
      capability_id:     command_request.command_scope.capability_id,
      handler_intent_id: command_request.command_scope.handler_intent_id,
      command_class:     command_request.command_scope.command_class,
      target_scope:      input.target_scope,
    },
    prepared_at: invoked_at,
    expires_at:  isoPlusMs(invoked_at, MUTATION_TTL_MS),
    ttl_ms:      MUTATION_TTL_MS,
  };

  return {
    chain_idempotency_key,
    invocation_idempotency_key,
    command_request,
    mutation_request,
  };
}
