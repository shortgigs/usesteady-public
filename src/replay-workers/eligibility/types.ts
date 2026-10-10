/**
 * Replay worker eligibility types (descriptive gate only).
 * @see docs/product/replay-worker-eligibility-contract-v1.md
 */

import type { ReplayExecutionRecord } from "../../replay-execution/types.js";

export type ReplayWorkerEligibilityState = "allowed" | "blocked" | "expired";

export type ReplayWorkerEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated";
  readonly replay_worker_eligibility_state: ReplayWorkerEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplayWorkerEligibilityRecord = {
  readonly replay_worker_eligibility_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_eligibility_state: ReplayWorkerEligibilityState;
  readonly replay_worker_eligibility_checked_at: string;
  readonly replay_worker_eligibility_ttl_ms: number;
  readonly replay_worker_eligibility_expires_at: string;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ReplayWorkerEligibilityLineageEntry[];
};

export type EvaluateReplayWorkerEligibilityInput = {
  readonly replay_execution: ReplayExecutionRecord;
  readonly now?: Date;
  readonly replay_worker_eligibility_ttl_ms?: number;
};
