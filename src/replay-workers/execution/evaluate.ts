/**
 * Pure replay worker execution eligibility evaluator.
 * @see docs/product/replay-worker-execution-implementation-contract-v1.md
 */

import type { ReplayWorkerDispatchRecord, ReplayWorkerDispatchState } from "../dispatch/types.js";
import { REPLAY_WORKER_EXECUTION_ELIGIBILITY_TTL_MS } from "./constants.js";
import {
  replayWorkerExecutionEligibilityId,
} from "./record-id.js";
import type {
  EvaluateReplayWorkerExecutionEligibilityInput,
  ReplayWorkerExecutionEligibilityLineageEntry,
  ReplayWorkerExecutionEligibilityRecord,
  ReplayWorkerExecutionEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isKnownDispatchState(
  state: string,
): state is ReplayWorkerDispatchState {
  return state === "dispatched" || state === "blocked" || state === "expired";
}

function isDispatchIncomplete(dispatch: ReplayWorkerDispatchRecord): boolean {
  return (
    dispatch.replay_worker_dispatch_id.trim().length === 0 ||
    dispatch.replay_execution_id.trim().length === 0 ||
    dispatch.replay_worker_dispatch_created_at.trim().length === 0
  );
}

type EligibilityDecision = {
  readonly replay_worker_execution_eligibility_state: ReplayWorkerExecutionEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideExecutionEligibility(
  dispatch: ReplayWorkerDispatchRecord,
  now: Date,
  ttl_ms: number,
): EligibilityDecision {
  if (isDispatchIncomplete(dispatch)) {
    return {
      replay_worker_execution_eligibility_state: "blocked",
      reason:         "Replay worker dispatch record is incomplete.",
      blocking_cause: "record_incomplete",
    };
  }

  const dispatch_state = dispatch.replay_worker_dispatch_state;

  if (!isKnownDispatchState(dispatch_state)) {
    return {
      replay_worker_execution_eligibility_state: "blocked",
      reason:         "Replay worker execution eligibility policy fail-closed.",
      blocking_cause: "policy_ambiguous",
    };
  }

  if (dispatch_state === "blocked") {
    return {
      replay_worker_execution_eligibility_state: "blocked",
      reason:         dispatch.replay_worker_dispatch_reason,
      blocking_cause: "dispatch_blocked",
    };
  }

  if (dispatch_state === "expired") {
    return {
      replay_worker_execution_eligibility_state: "expired",
      reason:         dispatch.replay_worker_dispatch_reason,
      blocking_cause: "dispatch_expired",
    };
  }

  const dispatch_created = Date.parse(dispatch.replay_worker_dispatch_created_at);
  if (Number.isNaN(dispatch_created) || now.getTime() > dispatch_created + ttl_ms) {
    return {
      replay_worker_execution_eligibility_state: "expired",
      reason:         "Replay worker execution eligibility TTL has elapsed since dispatch.",
      blocking_cause: "execution_eligibility_ttl_expired",
    };
  }

  if (dispatch_state !== "dispatched") {
    return {
      replay_worker_execution_eligibility_state: "blocked",
      reason:         "Replay worker dispatch was not in dispatched state.",
      blocking_cause: "dispatch_not_dispatched",
    };
  }

  return {
    replay_worker_execution_eligibility_state: "allowed",
    reason:         "Replay worker dispatch is eligible for bounded execution recording.",
    blocking_cause: "none",
  };
}

function buildRecord(input: {
  readonly dispatch: ReplayWorkerDispatchRecord;
  readonly decision: EligibilityDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ReplayWorkerExecutionEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ReplayWorkerExecutionEligibilityLineageEntry[] = [
    {
      at:   input.checked_at,
      kind: "evaluated",
      replay_worker_execution_eligibility_state: input.decision.replay_worker_execution_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    },
  ];

  const replay_worker_dispatch_id = input.dispatch.replay_worker_dispatch_id.trim();
  const replay_execution_id = input.dispatch.replay_execution_id.trim();

  return {
    replay_worker_dispatch_id,
    replay_execution_id,
    replay_worker_execution_eligibility_state: input.decision.replay_worker_execution_eligibility_state,
    replay_worker_execution_eligibility_checked_at: input.checked_at,
    replay_worker_execution_eligibility_ttl_ms:      input.ttl_ms,
    replay_worker_execution_eligibility_expires_at:  expires_at,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
    lineage,
    replay_worker_execution_eligibility_id: replayWorkerExecutionEligibilityId({
      replay_worker_dispatch_id,
      replay_execution_id,
      replay_worker_execution_eligibility_state: input.decision.replay_worker_execution_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    }),
  };
}

/**
 * Pure evaluator — ReplayWorkerDispatchRecord only; no I/O or worker execution.
 */
export function evaluateReplayWorkerExecutionEligibility(
  input: EvaluateReplayWorkerExecutionEligibilityInput,
): ReplayWorkerExecutionEligibilityRecord {
  const now = input.now ?? new Date();
  const checked_at = now.toISOString();
  const ttl_ms =
    input.replay_worker_execution_eligibility_ttl_ms ??
    REPLAY_WORKER_EXECUTION_ELIGIBILITY_TTL_MS;
  const decision = decideExecutionEligibility(
    input.replay_worker_dispatch,
    now,
    ttl_ms,
  );

  return buildRecord({
    dispatch: input.replay_worker_dispatch,
    decision,
    checked_at,
    ttl_ms,
  });
}
