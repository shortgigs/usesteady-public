/**
 * Pure replay worker eligibility evaluator (no dispatch authority).
 * @see docs/product/replay-worker-eligibility-implementation-contract-v1.md
 */

import type { ReplayExecutionRecord, ReplayExecutionState } from "../../replay-execution/types.js";
import { REPLAY_WORKER_ELIGIBILITY_TTL_MS } from "./constants.js";
import { replayWorkerEligibilityId } from "./record-id.js";
import type {
  EvaluateReplayWorkerEligibilityInput,
  ReplayWorkerEligibilityLineageEntry,
  ReplayWorkerEligibilityRecord,
  ReplayWorkerEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isRecordIncomplete(record: ReplayExecutionRecord): boolean {
  return (
    record.replay_execution_id.trim().length === 0 ||
    record.replay_sandbox_id.trim().length === 0 ||
    record.replay_execution_created_at.trim().length === 0
  );
}

function isKnownExecutionState(
  state: string,
): state is ReplayExecutionState {
  return state === "executed" || state === "blocked" || state === "expired";
}

type EligibilityDecision = {
  readonly replay_worker_eligibility_state: ReplayWorkerEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideReplayWorkerEligibility(
  record: ReplayExecutionRecord,
  now: Date,
  ttl_ms: number,
): EligibilityDecision {
  if (isRecordIncomplete(record)) {
    return {
      replay_worker_eligibility_state: "blocked",
      reason:         "Replay execution record is incomplete.",
      blocking_cause: "record_incomplete",
    };
  }

  const execution_state = record.replay_execution_state;

  if (!isKnownExecutionState(execution_state)) {
    return {
      replay_worker_eligibility_state: "blocked",
      reason:         "Replay worker eligibility policy fail-closed.",
      blocking_cause: "policy_ambiguous",
    };
  }

  if (execution_state === "blocked") {
    return {
      replay_worker_eligibility_state: "blocked",
      reason:         "Replay execution was blocked.",
      blocking_cause: "replay_execution_blocked",
    };
  }

  if (execution_state === "expired") {
    return {
      replay_worker_eligibility_state: "expired",
      reason:         "Replay execution record has expired.",
      blocking_cause: "replay_execution_expired",
    };
  }

  const created_at = Date.parse(record.replay_execution_created_at);
  if (Number.isNaN(created_at) || now.getTime() > created_at + ttl_ms) {
    return {
      replay_worker_eligibility_state: "expired",
      reason:         "Replay worker eligibility TTL has elapsed.",
      blocking_cause: "eligibility_ttl_expired",
    };
  }

  return {
    replay_worker_eligibility_state: "allowed",
    reason:         "Replay execution record is eligible for worker dispatch approach until TTL expires.",
    blocking_cause: "none",
  };
}

function buildRecord(input: {
  readonly replay_execution: ReplayExecutionRecord;
  readonly decision: EligibilityDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ReplayWorkerEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ReplayWorkerEligibilityLineageEntry[] = [
    {
      at:   input.checked_at,
      kind: "evaluated",
      replay_worker_eligibility_state: input.decision.replay_worker_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    },
  ];

  const replay_execution_id = input.replay_execution.replay_execution_id.trim();

  return {
    replay_execution_id,
    replay_worker_eligibility_state: input.decision.replay_worker_eligibility_state,
    replay_worker_eligibility_checked_at: input.checked_at,
    replay_worker_eligibility_ttl_ms:      input.ttl_ms,
    replay_worker_eligibility_expires_at:  expires_at,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
    lineage,
    replay_worker_eligibility_id: replayWorkerEligibilityId({
      replay_execution_id,
      replay_worker_eligibility_state: input.decision.replay_worker_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    }),
  };
}

/**
 * Pure evaluator — ReplayExecutionRecord only; no I/O or worker dispatch.
 */
export function evaluateReplayWorkerEligibility(
  input: EvaluateReplayWorkerEligibilityInput,
): ReplayWorkerEligibilityRecord {
  const now = input.now ?? new Date();
  const checked_at = now.toISOString();
  const ttl_ms = input.replay_worker_eligibility_ttl_ms ?? REPLAY_WORKER_ELIGIBILITY_TTL_MS;
  const decision = decideReplayWorkerEligibility(input.replay_execution, now, ttl_ms);

  return buildRecord({
    replay_execution: input.replay_execution,
    decision,
    checked_at,
    ttl_ms,
  });
}

/** Stable outcome fingerprint (excludes checked_at, expires_at, lineage). */
export function replayWorkerEligibilityOutcomeFingerprint(
  record: ReplayWorkerEligibilityRecord,
): string {
  return JSON.stringify({
    replay_worker_eligibility_id:     record.replay_worker_eligibility_id,
    replay_execution_id:              record.replay_execution_id,
    replay_worker_eligibility_state:  record.replay_worker_eligibility_state,
    reason:                             record.reason,
    blocking_cause:                     record.blocking_cause,
    replay_worker_eligibility_ttl_ms:   record.replay_worker_eligibility_ttl_ms,
  });
}
