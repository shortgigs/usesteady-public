/**
 * Pure replay worker side-effect eligibility evaluator.
 * @see docs/product/replay-worker-side-effect-runtime-contract-v1.md
 */

import type { ReplayWorkerExecutionRecord, ReplayWorkerExecutionState } from "../execution/types.js";
import { REPLAY_WORKER_SIDE_EFFECT_ELIGIBILITY_TTL_MS } from "./constants.js";
import {
  replayWorkerSideEffectEligibilityId,
} from "./record-id.js";
import type {
  EvaluateReplayWorkerSideEffectEligibilityInput,
  ReplayWorkerSideEffectEligibilityLineageEntry,
  ReplayWorkerSideEffectEligibilityRecord,
  ReplayWorkerSideEffectEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isKnownExecutionState(
  state: string,
): state is ReplayWorkerExecutionState {
  return state === "executed" || state === "blocked" || state === "expired";
}

function isExecutionIncomplete(execution: ReplayWorkerExecutionRecord): boolean {
  return (
    execution.replay_worker_execution_id.trim().length === 0 ||
    execution.replay_worker_dispatch_id.trim().length === 0 ||
    execution.replay_execution_id.trim().length === 0 ||
    execution.job_id.trim().length === 0 ||
    execution.replay_worker_execution_created_at.trim().length === 0
  );
}

type EligibilityDecision = {
  readonly replay_worker_side_effect_eligibility_state: ReplayWorkerSideEffectEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideSideEffectEligibility(
  execution: ReplayWorkerExecutionRecord,
  now: Date,
  ttl_ms: number,
): EligibilityDecision {
  if (isExecutionIncomplete(execution)) {
    return {
      replay_worker_side_effect_eligibility_state: "blocked",
      reason:         "Replay worker execution record is incomplete.",
      blocking_cause: "record_incomplete",
    };
  }

  const execution_state = execution.replay_worker_execution_state;

  if (!isKnownExecutionState(execution_state)) {
    return {
      replay_worker_side_effect_eligibility_state: "blocked",
      reason:         "Replay worker side-effect eligibility policy fail-closed.",
      blocking_cause: "policy_ambiguous",
    };
  }

  if (execution_state === "blocked") {
    return {
      replay_worker_side_effect_eligibility_state: "blocked",
      reason:         execution.replay_worker_execution_reason,
      blocking_cause: "execution_blocked",
    };
  }

  if (execution_state === "expired") {
    return {
      replay_worker_side_effect_eligibility_state: "expired",
      reason:         execution.replay_worker_execution_reason,
      blocking_cause: "execution_expired",
    };
  }

  const execution_created = Date.parse(execution.replay_worker_execution_created_at);
  if (Number.isNaN(execution_created) || now.getTime() > execution_created + ttl_ms) {
    return {
      replay_worker_side_effect_eligibility_state: "expired",
      reason:         "Replay worker side-effect eligibility TTL has elapsed since execution.",
      blocking_cause: "side_effect_eligibility_ttl_expired",
    };
  }

  if (execution_state !== "executed") {
    return {
      replay_worker_side_effect_eligibility_state: "blocked",
      reason:         "Replay worker execution was not in executed state.",
      blocking_cause: "execution_not_executed",
    };
  }

  return {
    replay_worker_side_effect_eligibility_state: "allowed",
    reason:         "Replay worker execution is eligible for bounded side-effect recording.",
    blocking_cause: "none",
  };
}

function buildRecord(input: {
  readonly execution: ReplayWorkerExecutionRecord;
  readonly decision: EligibilityDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ReplayWorkerSideEffectEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ReplayWorkerSideEffectEligibilityLineageEntry[] = [
    {
      at:   input.checked_at,
      kind: "evaluated",
      replay_worker_side_effect_eligibility_state: input.decision.replay_worker_side_effect_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    },
  ];

  const replay_worker_execution_id = input.execution.replay_worker_execution_id.trim();
  const replay_worker_dispatch_id = input.execution.replay_worker_dispatch_id.trim();
  const replay_execution_id = input.execution.replay_execution_id.trim();

  return {
    job_id: input.execution.job_id.trim(),
    replay_worker_execution_id,
    replay_worker_dispatch_id,
    replay_execution_id,
    replay_worker_side_effect_eligibility_state: input.decision.replay_worker_side_effect_eligibility_state,
    replay_worker_side_effect_eligibility_checked_at: input.checked_at,
    replay_worker_side_effect_eligibility_ttl_ms:      input.ttl_ms,
    replay_worker_side_effect_eligibility_expires_at:  expires_at,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
    lineage,
    replay_worker_side_effect_eligibility_id: replayWorkerSideEffectEligibilityId({
      replay_worker_execution_id,
      replay_execution_id,
      replay_worker_side_effect_eligibility_state: input.decision.replay_worker_side_effect_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    }),
  };
}

/**
 * Pure evaluator — ReplayWorkerExecutionRecord only; no I/O or mutation.
 */
export function evaluateReplayWorkerSideEffectEligibility(
  input: EvaluateReplayWorkerSideEffectEligibilityInput,
): ReplayWorkerSideEffectEligibilityRecord {
  const now = input.now ?? new Date();
  const checked_at = now.toISOString();
  const ttl_ms =
    input.replay_worker_side_effect_eligibility_ttl_ms ??
    REPLAY_WORKER_SIDE_EFFECT_ELIGIBILITY_TTL_MS;
  const decision = decideSideEffectEligibility(
    input.replay_worker_execution,
    now,
    ttl_ms,
  );

  return buildRecord({
    execution: input.replay_worker_execution,
    decision,
    checked_at,
    ttl_ms,
  });
}
