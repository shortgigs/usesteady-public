/**
 * Pure bounded replay worker execution recorder (no I/O, mutation, or reruns).
 * @see docs/product/replay-worker-execution-implementation-contract-v1.md
 */

import { isReplayWorkerExecutionEligibilityExpired } from "./expire.js";
import { REPLAY_WORKER_EXECUTION_VERSION } from "./constants.js";
import { replayWorkerExecutionId } from "./record-id.js";
import type {
  ReplayWorkerExecutionLineageEntry,
  ReplayWorkerExecutionRecord,
  ReplayWorkerExecutionState,
  RunBoundedReplayWorkerInput,
} from "./types.js";

type ExecutionDecision = {
  readonly replay_worker_execution_state: ReplayWorkerExecutionState;
  readonly replay_worker_execution_reason: string;
  readonly lineage_kind: ReplayWorkerExecutionLineageEntry["kind"];
};

function decideExecution(input: {
  readonly job_id: string;
  readonly operator_confirmation: boolean;
  readonly eligibility_state: string;
  readonly eligibility_expired: boolean;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
}): ExecutionDecision {
  if (input.job_id.trim().length === 0) {
    return {
      replay_worker_execution_state: "blocked",
      replay_worker_execution_reason:
        "Replay worker execution requires a non-empty job_id scope.",
      lineage_kind: "replay_worker_execution_blocked",
    };
  }

  if (input.operator_confirmation !== true) {
    return {
      replay_worker_execution_state: "blocked",
      replay_worker_execution_reason:
        "Replay worker execution requires operator_confirmation: true.",
      lineage_kind: "replay_worker_execution_blocked",
    };
  }

  if (input.eligibility_expired) {
    return {
      replay_worker_execution_state: "expired",
      replay_worker_execution_reason:
        "Replay worker execution eligibility TTL has expired at execution time.",
      lineage_kind: "replay_worker_execution_expired",
    };
  }

  if (input.eligibility_state === "expired") {
    return {
      replay_worker_execution_state: "expired",
      replay_worker_execution_reason:
        "Replay worker execution eligibility was expired.",
      lineage_kind: "replay_worker_execution_expired",
    };
  }

  if (input.eligibility_state === "blocked") {
    return {
      replay_worker_execution_state: "blocked",
      replay_worker_execution_reason:
        "Replay worker execution eligibility was blocked.",
      lineage_kind: "replay_worker_execution_blocked",
    };
  }

  if (input.eligibility_state !== "allowed") {
    return {
      replay_worker_execution_state: "blocked",
      replay_worker_execution_reason:
        "Replay worker execution policy fail-closed.",
      lineage_kind: "replay_worker_execution_blocked",
    };
  }

  if (
    input.replay_worker_dispatch_id.trim().length === 0 ||
    input.replay_execution_id.trim().length === 0
  ) {
    return {
      replay_worker_execution_state: "blocked",
      replay_worker_execution_reason:
        "Replay worker execution eligibility scope is incomplete.",
      lineage_kind: "replay_worker_execution_blocked",
    };
  }

  return {
    replay_worker_execution_state: "executed",
    replay_worker_execution_reason:
      "Replay worker execution recorded (descriptive only — no filesystem mutation).",
    lineage_kind: "replay_worker_execution_executed",
  };
}

function buildLineage(
  created_at: string,
  decision: ExecutionDecision,
): readonly ReplayWorkerExecutionLineageEntry[] {
  const requested: ReplayWorkerExecutionLineageEntry = {
    at:   created_at,
    kind: "replay_worker_execution_requested",
  };

  if (decision.replay_worker_execution_state === "executed") {
    return [
      requested,
      { at: created_at, kind: "replay_worker_execution_executed" },
    ];
  }

  return [
    requested,
    {
      at:   created_at,
      kind: decision.lineage_kind,
      note: decision.replay_worker_execution_reason,
    },
  ];
}

/**
 * Pure execution recorder — eligibility + confirmation only; no worker I/O.
 */
export function runBoundedReplayWorker(
  input: RunBoundedReplayWorkerInput,
): ReplayWorkerExecutionRecord {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const eligibility = input.replay_worker_execution_eligibility;

  const decision = decideExecution({
    job_id:                    input.job_id,
    operator_confirmation:     input.operator_confirmation === true,
    eligibility_state:       eligibility.replay_worker_execution_eligibility_state,
    eligibility_expired:       isReplayWorkerExecutionEligibilityExpired(eligibility, now),
    replay_worker_dispatch_id: eligibility.replay_worker_dispatch_id,
    replay_execution_id:       eligibility.replay_execution_id,
  });

  const replay_execution_id = eligibility.replay_execution_id.trim();

  return {
    job_id:                    input.job_id.trim(),
    replay_worker_dispatch_id: eligibility.replay_worker_dispatch_id.trim(),
    replay_execution_id,
    replay_worker_execution_state:  decision.replay_worker_execution_state,
    replay_worker_execution_created_at: created_at,
    replay_worker_execution_version:    REPLAY_WORKER_EXECUTION_VERSION,
    replay_worker_execution_reason:     decision.replay_worker_execution_reason,
    replay_worker_execution_lineage:    buildLineage(created_at, decision),
    replay_worker_execution_id: replayWorkerExecutionId({
      replay_execution_id,
      replay_worker_execution_state:  decision.replay_worker_execution_state,
      replay_worker_execution_version:  REPLAY_WORKER_EXECUTION_VERSION,
    }),
  };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerExecutionOutcomeFingerprint(
  record: ReplayWorkerExecutionRecord,
): string {
  return JSON.stringify({
    replay_worker_execution_id:     record.replay_worker_execution_id,
    replay_execution_id:            record.replay_execution_id,
    replay_worker_dispatch_id:      record.replay_worker_dispatch_id,
    replay_worker_execution_state:  record.replay_worker_execution_state,
    replay_worker_execution_version: record.replay_worker_execution_version,
    replay_worker_execution_reason: record.replay_worker_execution_reason,
  });
}
