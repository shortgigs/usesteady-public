/**
 * Production replay execution types (isolated lineage only).
 * @see docs/product/production-replay-execution-contract-v1.md
 */

import type { ReplaySandboxCandidate } from "../replay-sandbox/types.js";
import type { ReplayExecutionEligibilityRecord } from "./eligibility/types.js";

export type ReplayExecutionState = "executed" | "blocked" | "expired";

export type ReplayExecutionLineageKind =
  | "replay_gate_passed"
  | "replay_execution_started"
  | "replay_execution_completed"
  | "replay_execution_blocked"
  | "replay_execution_expired";

export type ReplayExecutionLineageEntry = {
  readonly at: string;
  readonly kind: ReplayExecutionLineageKind;
  readonly note?: string;
};

export type ReplayExecutionRecord = {
  readonly replay_execution_id: string;
  readonly replay_sandbox_id: string;
  readonly replay_execution_state: ReplayExecutionState;
  readonly replay_execution_created_at: string;
  readonly replay_execution_version: string;
  readonly replay_execution_lineage: readonly ReplayExecutionLineageEntry[];
  readonly replay_execution_reason: string;
};

export type ExecuteReplaySandboxCandidateInput = {
  readonly replay_candidate: ReplaySandboxCandidate;
  readonly replay_execution_eligibility: ReplayExecutionEligibilityRecord;
  readonly operator_confirmation: true;
  readonly now?: Date;
  readonly replay_execution_created_at?: string;
};

export class ReplayExecutionRejectedError extends Error {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ReplayExecutionRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
