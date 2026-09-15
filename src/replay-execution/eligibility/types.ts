/**
 * Replay execution eligibility types (descriptive gate only).
 * @see docs/product/replay-execution-eligibility-contract-v1.md
 */

import type { ReplaySandboxCandidate } from "../../replay-sandbox/types.js";

export type ReplayExecutionEligibilityState = "allowed" | "blocked" | "expired";

export type ReplayExecutionEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated";
  readonly replay_execution_eligibility_state: ReplayExecutionEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplayExecutionEligibilityRecord = {
  readonly replay_execution_eligibility_record_id: string;
  readonly replay_sandbox_id: string;
  readonly source_execution_id: string;
  readonly reconstructed_capability_id: string;
  readonly replay_execution_eligibility_state: ReplayExecutionEligibilityState;
  readonly replay_execution_eligibility_checked_at: string;
  readonly replay_execution_eligibility_expires_at: string;
  readonly replay_execution_eligibility_ttl_ms: number;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ReplayExecutionEligibilityLineageEntry[];
};

export type EvaluateReplayExecutionEligibilityInput = {
  readonly replay_sandbox_candidate: ReplaySandboxCandidate;
  readonly now?: Date;
  readonly replay_execution_eligibility_ttl_ms?: number;
};
