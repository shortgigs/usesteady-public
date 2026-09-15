/**
 * Replay worker execution types (descriptive only — no execution authority).
 * @see docs/product/replay-worker-execution-contract-v1.md
 */

import type { ReplayWorkerDispatchRecord } from "../dispatch/types.js";

export type ReplayWorkerExecutionEligibilityState = "allowed" | "blocked" | "expired";

export type ReplayWorkerExecutionEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated";
  readonly replay_worker_execution_eligibility_state: ReplayWorkerExecutionEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplayWorkerExecutionEligibilityRecord = {
  readonly replay_worker_execution_eligibility_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_execution_eligibility_state: ReplayWorkerExecutionEligibilityState;
  readonly replay_worker_execution_eligibility_checked_at: string;
  readonly replay_worker_execution_eligibility_ttl_ms: number;
  readonly replay_worker_execution_eligibility_expires_at: string;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ReplayWorkerExecutionEligibilityLineageEntry[];
};

export type EvaluateReplayWorkerExecutionEligibilityInput = {
  readonly replay_worker_dispatch: ReplayWorkerDispatchRecord;
  readonly now?: Date;
  readonly replay_worker_execution_eligibility_ttl_ms?: number;
};

export type ReplayWorkerExecutionState = "executed" | "blocked" | "expired";

export type ReplayWorkerExecutionLineageKind =
  | "replay_worker_execution_requested"
  | "replay_worker_execution_executed"
  | "replay_worker_execution_blocked"
  | "replay_worker_execution_expired";

export type ReplayWorkerExecutionLineageEntry = {
  readonly at: string;
  readonly kind: ReplayWorkerExecutionLineageKind;
  readonly note?: string;
};

export type ReplayWorkerExecutionRecord = {
  readonly replay_worker_execution_id: string;
  readonly job_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_execution_state: ReplayWorkerExecutionState;
  readonly replay_worker_execution_created_at: string;
  readonly replay_worker_execution_version: string;
  readonly replay_worker_execution_reason: string;
  readonly replay_worker_execution_lineage: readonly ReplayWorkerExecutionLineageEntry[];
};

export type RunBoundedReplayWorkerInput = {
  readonly job_id: string;
  readonly replay_worker_execution_eligibility: ReplayWorkerExecutionEligibilityRecord;
  readonly operator_confirmation: true;
  readonly now?: Date;
};
