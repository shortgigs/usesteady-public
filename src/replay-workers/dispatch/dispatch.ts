/**
 * Pure replay worker dispatch (no worker execution, I/O, or reruns).
 * @see docs/product/replay-worker-dispatch-implementation-contract-v1.md
 */

import { isReplayWorkerEligibilityExpired } from "../eligibility/expire.js";
import type { ReplayWorkerEligibilityRecord } from "../eligibility/types.js";
import { REPLAY_WORKER_DISPATCH_VERSION } from "./constants.js";
import { replayWorkerDispatchId } from "./record-id.js";
import type {
  DispatchReplayWorkerInput,
  ReplayWorkerDispatchLineageEntry,
  ReplayWorkerDispatchRecord,
  ReplayWorkerDispatchState,
} from "./types.js";

type DispatchDecision = {
  readonly replay_worker_dispatch_state: ReplayWorkerDispatchState;
  readonly replay_worker_dispatch_reason: string;
  readonly lineage_kind: ReplayWorkerDispatchLineageEntry["kind"];
};

function isEligibilityShapeValid(
  record: ReplayWorkerEligibilityRecord,
): boolean {
  return (
    record.replay_execution_id.trim().length > 0 &&
    record.replay_worker_eligibility_id.trim().length > 0 &&
    (record.replay_worker_eligibility_state === "allowed" ||
      record.replay_worker_eligibility_state === "blocked" ||
      record.replay_worker_eligibility_state === "expired")
  );
}

function decideDispatch(input: {
  readonly job_id: string;
  readonly replay_worker_eligibility: ReplayWorkerEligibilityRecord;
  readonly operator_confirmation: boolean;
  readonly now: Date;
}): DispatchDecision {
  if (input.job_id.trim().length === 0) {
    return {
      replay_worker_dispatch_state: "blocked",
      replay_worker_dispatch_reason:
        "Replay worker dispatch requires a non-empty job_id scope.",
      lineage_kind: "replay_worker_dispatch_blocked",
    };
  }

  if (!isEligibilityShapeValid(input.replay_worker_eligibility)) {
    return {
      replay_worker_dispatch_state: "blocked",
      replay_worker_dispatch_reason:
        "Replay worker dispatch policy fail-closed (ambiguous eligibility).",
      lineage_kind: "replay_worker_dispatch_blocked",
    };
  }

  if (input.operator_confirmation !== true) {
    return {
      replay_worker_dispatch_state: "blocked",
      replay_worker_dispatch_reason:
        "Replay worker dispatch requires operator_confirmation: true.",
      lineage_kind: "replay_worker_dispatch_blocked",
    };
  }

  if (isReplayWorkerEligibilityExpired(input.replay_worker_eligibility, input.now)) {
    return {
      replay_worker_dispatch_state: "expired",
      replay_worker_dispatch_reason:
        "Replay worker eligibility TTL has expired at dispatch time.",
      lineage_kind: "replay_worker_dispatch_expired",
    };
  }

  const eligibility_state = input.replay_worker_eligibility.replay_worker_eligibility_state;

  if (eligibility_state === "expired") {
    return {
      replay_worker_dispatch_state: "expired",
      replay_worker_dispatch_reason: input.replay_worker_eligibility.reason,
      lineage_kind: "replay_worker_dispatch_expired",
    };
  }

  if (eligibility_state === "blocked") {
    return {
      replay_worker_dispatch_state: "blocked",
      replay_worker_dispatch_reason: input.replay_worker_eligibility.reason,
      lineage_kind: "replay_worker_dispatch_blocked",
    };
  }

  if (eligibility_state !== "allowed") {
    return {
      replay_worker_dispatch_state: "blocked",
      replay_worker_dispatch_reason:
        "Replay worker dispatch policy fail-closed.",
      lineage_kind: "replay_worker_dispatch_blocked",
    };
  }

  return {
    replay_worker_dispatch_state: "dispatched",
    replay_worker_dispatch_reason:
      "Replay worker dispatch recorded (descriptive only — no worker execution).",
    lineage_kind: "replay_worker_dispatch_completed",
  };
}

function buildLineage(
  created_at: string,
  decision: DispatchDecision,
): readonly ReplayWorkerDispatchLineageEntry[] {
  const requested: ReplayWorkerDispatchLineageEntry = {
    at:   created_at,
    kind: "replay_worker_dispatch_requested",
  };

  if (decision.replay_worker_dispatch_state === "dispatched") {
    return [
      requested,
      { at: created_at, kind: "replay_worker_dispatch_completed" },
    ];
  }

  return [
    requested,
    {
      at:   created_at,
      kind: decision.lineage_kind,
      note: decision.replay_worker_dispatch_reason,
    },
  ];
}

/**
 * Pure dispatch — ReplayWorkerEligibilityRecord only; no I/O or worker execution.
 */
export function dispatchReplayWorker(
  input: DispatchReplayWorkerInput,
): ReplayWorkerDispatchRecord {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const decision = decideDispatch({
    job_id:                    input.job_id,
    replay_worker_eligibility: input.replay_worker_eligibility,
    operator_confirmation:     input.operator_confirmation === true,
    now,
  });

  const replay_execution_id = input.replay_worker_eligibility.replay_execution_id.trim();

  return {
    replay_execution_id,
    replay_worker_dispatch_state:  decision.replay_worker_dispatch_state,
    replay_worker_dispatch_created_at: created_at,
    replay_worker_dispatch_version:    REPLAY_WORKER_DISPATCH_VERSION,
    replay_worker_dispatch_reason:     decision.replay_worker_dispatch_reason,
    replay_worker_dispatch_lineage:    buildLineage(created_at, decision),
    replay_worker_dispatch_id: replayWorkerDispatchId({
      replay_execution_id,
      replay_worker_dispatch_state:  decision.replay_worker_dispatch_state,
      replay_worker_dispatch_version:  REPLAY_WORKER_DISPATCH_VERSION,
    }),
  };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerDispatchOutcomeFingerprint(
  record: ReplayWorkerDispatchRecord,
): string {
  return JSON.stringify({
    replay_worker_dispatch_id:     record.replay_worker_dispatch_id,
    replay_execution_id:           record.replay_execution_id,
    replay_worker_dispatch_state:  record.replay_worker_dispatch_state,
    replay_worker_dispatch_version: record.replay_worker_dispatch_version,
    replay_worker_dispatch_reason: record.replay_worker_dispatch_reason,
  });
}
