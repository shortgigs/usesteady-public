/**
 * UI worker chain integration HTTP DTOs (server orchestration + descriptive projection).
 * @see docs/product/executor-ui-worker-chain-integration-contract-v1.md
 */

import type { RunExecutorPipelineInput } from "../wire-up/types.js";
import type { MutationAuthorizationRequestBody } from "./mutation-wiring-types.js";
import type { WorkerResultOutcome } from "../worker/types.js";

export type UiChainIntakeRecord = {
  readonly intake_id: string;
  readonly authorization_request_id: string;
  readonly intent_idempotency_key: string;
  readonly status: "accepted" | "denied";
  readonly recorded_at: string;
  readonly lineage_ref: readonly string[];
};

export type WorkerChainStatusPhase =
  | "awaiting_authority"
  | "awaiting_job"
  | "worker_pending"
  | "chain_halted"
  | "chain_completed";

export type WorkerChainStatusProjection = {
  readonly projection_id: string;
  readonly job_id: string;
  readonly intent_idempotency_key: string;
  readonly phase: WorkerChainStatusPhase;
  readonly terminal_outcome?: WorkerResultOutcome;
  readonly halt_cause?: string;
  readonly authority_record_id?: string;
  readonly recorded_at: string;
  readonly descriptive_replay?: boolean;
};

export type UiChainIntakeRequestBody = {
  readonly authorization_request: MutationAuthorizationRequestBody["authorization_request"];
  readonly operator_mint_confirmation: true;
  readonly pipeline: Omit<RunExecutorPipelineInput, "now">;
};

export type UiChainIntakeSuccessBody = {
  readonly ok: true;
  readonly intake: UiChainIntakeRecord;
  readonly job_id: string;
  readonly projection: WorkerChainStatusProjection;
  readonly idempotent_replay?: boolean;
};

export type WorkerChainStatusSuccessBody = {
  readonly ok: true;
  readonly projection: WorkerChainStatusProjection;
  readonly idempotent_replay?: boolean;
};
