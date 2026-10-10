/**
 * Replay worker side-effect types (descriptive only — no mutation authority).
 * @see docs/product/replay-worker-side-effect-runtime-contract-v1.md
 */

import type { ReplayWorkerExecutionRecord } from "../execution/types.js";
import type { ReplayWorkerSideEffectScope } from "./constants.js";

export type ReplayWorkerSideEffectEligibilityState = "allowed" | "blocked" | "expired";

export type ReplayWorkerSideEffectEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated";
  readonly replay_worker_side_effect_eligibility_state: ReplayWorkerSideEffectEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplayWorkerSideEffectEligibilityRecord = {
  readonly replay_worker_side_effect_eligibility_id: string;
  readonly job_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_side_effect_eligibility_state: ReplayWorkerSideEffectEligibilityState;
  readonly replay_worker_side_effect_eligibility_checked_at: string;
  readonly replay_worker_side_effect_eligibility_ttl_ms: number;
  readonly replay_worker_side_effect_eligibility_expires_at: string;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ReplayWorkerSideEffectEligibilityLineageEntry[];
};

export type EvaluateReplayWorkerSideEffectEligibilityInput = {
  readonly replay_worker_execution: ReplayWorkerExecutionRecord;
  readonly now?: Date;
  readonly replay_worker_side_effect_eligibility_ttl_ms?: number;
};

export type ReplayWorkerSideEffectState = "recorded" | "blocked" | "expired";

export type ReplayWorkerSideEffectLineageKind =
  | "replay_worker_side_effect_requested"
  | "replay_worker_side_effect_recorded"
  | "replay_worker_side_effect_blocked"
  | "replay_worker_side_effect_expired";

export type ReplayWorkerSideEffectLineageEntry = {
  readonly at: string;
  readonly kind: ReplayWorkerSideEffectLineageKind;
  readonly note?: string;
};

export type ReplayWorkerSideEffectRecord = {
  readonly replay_worker_side_effect_id: string;
  readonly job_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_side_effect_state: ReplayWorkerSideEffectState;
  readonly replay_worker_side_effect_scope: ReplayWorkerSideEffectScope;
  readonly replay_worker_side_effect_created_at: string;
  readonly replay_worker_side_effect_version: string;
  readonly replay_worker_side_effect_reason: string;
  readonly replay_worker_side_effect_lineage: readonly ReplayWorkerSideEffectLineageEntry[];
};

export type RunBoundedReplayWorkerSideEffectInput = {
  readonly replay_worker_side_effect_eligibility: ReplayWorkerSideEffectEligibilityRecord;
  readonly operator_confirmation: true;
  readonly replay_worker_side_effect_scope: ReplayWorkerSideEffectScope;
  readonly now?: Date;
};
