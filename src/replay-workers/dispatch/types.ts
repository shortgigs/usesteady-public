/**
 * Replay worker dispatch types (descriptive only — no execution authority).
 * @see docs/product/replay-worker-dispatch-contract-v1.md
 */

import type { ReplayWorkerEligibilityRecord } from "../eligibility/types.js";

export type ReplayWorkerDispatchState = "dispatched" | "blocked" | "expired";

export type ReplayWorkerDispatchLineageKind =
  | "replay_worker_dispatch_requested"
  | "replay_worker_dispatch_completed"
  | "replay_worker_dispatch_blocked"
  | "replay_worker_dispatch_expired";

export type ReplayWorkerDispatchLineageEntry = {
  readonly at: string;
  readonly kind: ReplayWorkerDispatchLineageKind;
  readonly note?: string;
};

export type ReplayWorkerDispatchRecord = {
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_dispatch_state: ReplayWorkerDispatchState;
  readonly replay_worker_dispatch_created_at: string;
  readonly replay_worker_dispatch_version: string;
  readonly replay_worker_dispatch_reason: string;
  readonly replay_worker_dispatch_lineage: readonly ReplayWorkerDispatchLineageEntry[];
};

export type DispatchReplayWorkerInput = {
  readonly job_id: string;
  readonly replay_worker_eligibility: ReplayWorkerEligibilityRecord;
  readonly operator_confirmation: true;
  readonly now?: Date;
};
