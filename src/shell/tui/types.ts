/**
 * TUI v1.1 — Read-only workflow view types.
 *
 * v1.1 additions: TuiConsensusEntry + consensus field on WorkflowState.
 * ConsensusPanel shows only when status === "Blocked" AND multi-LLM was active.
 * Footer controls remain deferred.
 */

export type TuiStep = {
  readonly id:          number;
  readonly description: string;
  readonly status:      "pending" | "completed" | "failed" | "blocked" | "planning_reviewed";
};

/**
 * Top-level status string derived from WorkflowRunPhase in state-bridge.ts.
 * "Blocked" is set when phase === "task_failed" and the failure note signals
 * a policy/consensus block. Treat as non-frozen — a future pass will use a
 * safer signal once one is exposed by the coordinator.
 */
export type WorkflowStatus =
  | "Reviewing"
  | "Executing"
  | "Blocked"
  | "Completed"
  | "Stopped";

/**
 * One model's decision — shown in ConsensusPanel when status === "Blocked".
 *
 * Intentionally minimal (v2 scope):
 *   · label        — human-friendly name ("Claude", "Secondary", ...)
 *   · disposition  — one of four human-level outcomes
 *
 * What is NOT here (deferred to v2.1+):
 *   · Round counts, normalized hashes, rationale codes, plugin IDs
 *   · Per-round detail — too heavy for this surface
 */
export type TuiConsensusEntry = {
  readonly label:       string;
  readonly disposition: "Accepted" | "Scope concern" | "Execution error" | "Unknown";
};

export type WorkflowState = {
  readonly status:          WorkflowStatus;
  readonly steps:           readonly TuiStep[];
  readonly currentStepId?:  number;
  readonly systemWill?:     { readonly description: string };
  /**
   * Human-readable reason shown in BlockedReasonPanel when status === "Blocked".
   * Short, non-technical. Set by state-bridge from run.display.failureNote.
   * Absent when status is not Blocked.
   */
  readonly blockedReason?:  string;
  /**
   * Per-model decisions — shown in ConsensusPanel when status === "Blocked"
   * AND multi-LLM was active for this task. Absent for single-model runs
   * or when the run has not yet blocked.
   */
  readonly consensus?:      readonly TuiConsensusEntry[];
  readonly isComplete:      boolean;
};
