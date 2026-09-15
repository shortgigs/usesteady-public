/**
 * Server-side UI chain intake — operator mint + job + worker auto-wire (no inline invoke).
 */

import { createExecutionAuthorityRecord } from "../authority/create-execution-authority-record.js";
import type { ExecutionAuthorityRecord } from "../authority/types.js";
import type { BackgroundJobRecord } from "../jobs/types.js";
import { processBackgroundJob } from "../worker/process-background-job.js";
import type { WorkerResultRecord } from "../worker/types.js";
import { buildJobFromPipelineInput } from "./build-job-from-pipeline.js";
import { planWorkerAutoWireRequest } from "./plan-worker-auto-wire-request.js";
import type {
  UiChainIntakeRecord,
  UiChainIntakeRequestBody,
  WorkerChainStatusPhase,
  WorkerChainStatusProjection,
} from "./worker-chain-types.js";
import { ExecutorRouteRejectedError } from "./types.js";

function workerRequestForJob(
  job: BackgroundJobRecord,
  actor_id: string,
  target_scope: readonly string[],
): Parameters<typeof createExecutionAuthorityRecord>[0]["validation"] {
  const envelope = {
    capability_id:     job.capability_id,
    handler_intent_id: job.handler_intent_id,
    target_scope,
    job_kind:          job.job_kind,
  };
  return {
    request: {
      request_id:        `req-${job.job_id.slice(0, 12)}`,
      job_id:            job.job_id,
      execution_id:      job.execution_id,
      ledger_entry_id:   job.ledger_entry_id,
      handler_intent_id: job.handler_intent_id,
      job_kind:          job.job_kind,
      payload_hash:      job.payload_hash,
      prepared_at:       job.enqueued_at,
      note:              "operator approved ui chain intake",
    },
    actor_id,
    authorization_scope: envelope,
    reason: "operator minted execution authority (ui chain intake)",
    allowed_envelope: envelope,
    grant_source: { kind: "operator_gate", actor_id },
  };
}

function phaseFromOutcome(outcome: WorkerResultRecord["outcome"]): WorkerChainStatusPhase {
  switch (outcome) {
    case "awaiting_execution_authority":
      return "awaiting_authority";
    case "transport_completed":
    case "transport_failed":
    case "idempotent_skip":
      return "worker_pending";
    case "execution_chain_completed":
      return "chain_completed";
    case "execution_chain_halted":
    case "dead_letter":
      return "chain_halted";
  }
}

function buildProjection(input: {
  readonly job_id: string;
  readonly intent_idempotency_key: string;
  readonly result: WorkerResultRecord;
  readonly authority?: ExecutionAuthorityRecord;
  readonly now: Date;
  readonly descriptive_replay?: boolean;
}): WorkerChainStatusProjection {
  const phase = phaseFromOutcome(input.result.outcome);
  return {
    projection_id: `proj-${input.job_id.slice(0, 12)}-${input.now.getTime()}`,
    job_id:                    input.job_id,
    intent_idempotency_key:    input.intent_idempotency_key,
    phase,
    terminal_outcome:          input.result.outcome,
    ...(input.result.execution_chain?.halt_cause !== undefined ? { halt_cause: input.result.execution_chain?.halt_cause } : {}),
    ...(input.authority?.authority_record_id !== undefined ? { authority_record_id: input.authority?.authority_record_id } : {}),
    recorded_at:               input.now.toISOString(),
    ...(input.descriptive_replay !== undefined ? { descriptive_replay: input.descriptive_replay } : {}),
  };
}

export type OrchestrateUiChainIntakeOutput = {
  readonly intake: UiChainIntakeRecord;
  readonly job: BackgroundJobRecord;
  readonly projection: WorkerChainStatusProjection;
  readonly worker_result: WorkerResultRecord;
};

export function orchestrateUiChainIntake(
  body: UiChainIntakeRequestBody,
  now: Date,
): OrchestrateUiChainIntakeOutput {
  const intentKey = body.authorization_request.intent_idempotency_key.trim();
  const jobFromIntent = body.authorization_request.validated_intent.job_id.trim();

  const job = buildJobFromPipelineInput({
    ...body.pipeline,
    now,
  });

  if (job.job_id.trim() !== jobFromIntent) {
    throw new ExecutorRouteRejectedError(
      "intent_key_mismatch",
      "validated_intent.job_id does not match pipeline-derived job_id.",
    );
  }

  const actor_id = body.authorization_request.actor_id.trim();
  const target_scope = body.authorization_request.scope_envelope.target_scope;
  const authority = createExecutionAuthorityRecord({
    validation:      workerRequestForJob(job, actor_id, target_scope),
    idempotency_key: job.idempotency_key,
    now,
  });

  if (authority.decision !== "granted") {
    throw new ExecutorRouteRejectedError(
      "authority_denied",
      authority.denial_cause ?? "Execution authority denied at intake.",
    );
  }

  const auto_wire = planWorkerAutoWireRequest({
    job,
    authority,
    actor_id,
    now,
    target_scope,
  });

  const workerOut = processBackgroundJob({
    job,
    now,
    attempt:           1,
    authority_records: [authority],
    auto_wire,
  });

  const intake: UiChainIntakeRecord = {
    intake_id:               `intake-${intentKey.slice(0, 24)}`,
    authorization_request_id: body.authorization_request.authorization_request_id,
    intent_idempotency_key:  intentKey,
    status:                  "accepted",
    recorded_at:             now.toISOString(),
    lineage_ref: [
      body.authorization_request.authorization_request_id,
      authority.authority_record_id,
      job.job_id,
      workerOut.result.outcome,
    ],
  };

  const projection = buildProjection({
    job_id:                 job.job_id,
    intent_idempotency_key: intentKey,
    result:                 workerOut.result,
    authority,
    now,
  });

  return { intake, job, projection, worker_result: workerOut.result };
}

export { buildProjection };
