/**
 * Replay worker mutation types (bounded intent only — no unrestricted mutation).
 * @see docs/product/replay-worker-bounded-mutation-runtime-contract-v1.md
 */

import type { ReplayWorkerSideEffectRecord } from "../side-effect/types.js";
import type { ReplayWorkerMutationScope } from "./constants.js";

export type ReplayWorkerMutationEligibilityState = "allowed" | "blocked" | "expired";

export type ReplayWorkerMutationEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated";
  readonly replay_worker_mutation_eligibility_state: ReplayWorkerMutationEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplayWorkerMutationEligibilityRecord = {
  readonly replay_worker_mutation_eligibility_id: string;
  readonly job_id: string;
  readonly replay_worker_side_effect_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_mutation_eligibility_state: ReplayWorkerMutationEligibilityState;
  readonly replay_worker_mutation_eligibility_checked_at: string;
  readonly replay_worker_mutation_eligibility_ttl_ms: number;
  readonly replay_worker_mutation_eligibility_expires_at: string;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ReplayWorkerMutationEligibilityLineageEntry[];
};

export type EvaluateReplayWorkerMutationEligibilityInput = {
  readonly replay_worker_side_effect: ReplayWorkerSideEffectRecord;
  readonly now?: Date;
  readonly replay_worker_mutation_eligibility_ttl_ms?: number;
};

export type ReplayWorkerMutationState = "recorded" | "blocked" | "expired";

export type ReplayWorkerMutationLineageKind =
  | "replay_worker_mutation_requested"
  | "replay_worker_mutation_recorded"
  | "replay_worker_mutation_blocked"
  | "replay_worker_mutation_expired";

export type ReplayWorkerMutationLineageEntry = {
  readonly at: string;
  readonly kind: ReplayWorkerMutationLineageKind;
  readonly note?: string;
};

export type ReplayWorkerMutationRecord = {
  readonly replay_worker_mutation_id: string;
  readonly job_id: string;
  readonly replay_worker_side_effect_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_mutation_state: ReplayWorkerMutationState;
  readonly replay_worker_mutation_scope: ReplayWorkerMutationScope;
  readonly replay_worker_mutation_created_at: string;
  readonly replay_worker_mutation_version: string;
  readonly replay_worker_mutation_reason: string;
  readonly replay_worker_mutation_lineage: readonly ReplayWorkerMutationLineageEntry[];
};

export type RunBoundedReplayWorkerMutationInput = {
  readonly replay_worker_mutation_eligibility: ReplayWorkerMutationEligibilityRecord;
  readonly operator_confirmation: true;
  readonly replay_worker_mutation_scope: ReplayWorkerMutationScope;
  readonly now?: Date;
};
