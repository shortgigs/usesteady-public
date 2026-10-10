/**
 * Pure replay execution eligibility evaluator (no execution authority).
 * @see docs/product/replay-execution-eligibility-implementation-contract-v1.md
 */

import type { ReplaySandboxCandidate, ReplaySandboxState } from "../../replay-sandbox/types.js";
import { REPLAY_EXECUTION_ELIGIBILITY_TTL_MS } from "./constants.js";
import { replayExecutionEligibilityRecordId } from "./record-id.js";
import type {
  EvaluateReplayExecutionEligibilityInput,
  ReplayExecutionEligibilityLineageEntry,
  ReplayExecutionEligibilityRecord,
  ReplayExecutionEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isCandidateIncomplete(candidate: ReplaySandboxCandidate): boolean {
  return (
    candidate.replay_sandbox_id.trim().length === 0 ||
    candidate.execution_id.trim().length === 0 ||
    candidate.reconstructed_capability_id.trim().length === 0
  );
}

type EligibilityDecision = {
  readonly replay_execution_eligibility_state: ReplayExecutionEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideReplayExecutionEligibility(
  candidate: ReplaySandboxCandidate,
): EligibilityDecision {
  if (isCandidateIncomplete(candidate)) {
    return {
      replay_execution_eligibility_state: "blocked",
      reason:                   "Replay sandbox candidate record is incomplete.",
      blocking_cause:           "replay_record_incomplete",
    };
  }

  const replay_state: ReplaySandboxState = candidate.replay_state;

  if (replay_state === "blocked") {
    return {
      replay_execution_eligibility_state: "blocked",
      reason:                   "Replay sandbox candidate is blocked.",
      blocking_cause:           "replay_candidate_blocked",
    };
  }

  if (replay_state === "expired") {
    return {
      replay_execution_eligibility_state: "expired",
      reason:                   "Replay sandbox candidate has expired.",
      blocking_cause:           "replay_candidate_expired",
    };
  }

  if (replay_state === "candidate") {
    return {
      replay_execution_eligibility_state: "allowed",
      reason:                   "Replay sandbox candidate is eligible until TTL expires.",
      blocking_cause:           "",
    };
  }

  return {
    replay_execution_eligibility_state: "blocked",
    reason:                   "Replay execution eligibility policy fail-closed.",
    blocking_cause:           "replay_policy_fail_closed",
  };
}

function buildRecord(input: {
  readonly candidate: ReplaySandboxCandidate;
  readonly decision: EligibilityDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ReplayExecutionEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ReplayExecutionEligibilityLineageEntry[] = [
    {
      at:   input.checked_at,
      kind: "evaluated",
      replay_execution_eligibility_state: input.decision.replay_execution_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    },
  ];

  const replay_sandbox_id = input.candidate.replay_sandbox_id.trim();

  return {
    replay_sandbox_id,
    source_execution_id:              input.candidate.execution_id.trim(),
    reconstructed_capability_id:    input.candidate.reconstructed_capability_id.trim(),
    replay_execution_eligibility_state: input.decision.replay_execution_eligibility_state,
    replay_execution_eligibility_checked_at: input.checked_at,
    replay_execution_eligibility_ttl_ms:      input.ttl_ms,
    replay_execution_eligibility_expires_at:  expires_at,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
    lineage,
    replay_execution_eligibility_record_id: replayExecutionEligibilityRecordId({
      replay_sandbox_id,
      replay_execution_eligibility_state: input.decision.replay_execution_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    }),
  };
}

/**
 * Pure evaluator — ReplaySandboxCandidate only; no I/O or replay execution.
 */
export function evaluateReplayExecutionEligibility(
  input: EvaluateReplayExecutionEligibilityInput,
): ReplayExecutionEligibilityRecord {
  const now = input.now ?? new Date();
  const checked_at = now.toISOString();
  const ttl_ms = input.replay_execution_eligibility_ttl_ms ?? REPLAY_EXECUTION_ELIGIBILITY_TTL_MS;
  const decision = decideReplayExecutionEligibility(input.replay_sandbox_candidate);

  return buildRecord({
    candidate: input.replay_sandbox_candidate,
    decision,
    checked_at,
    ttl_ms,
  });
}

/** Stable outcome fingerprint (excludes checked_at, expires_at, lineage). */
export function replayExecutionEligibilityOutcomeFingerprint(
  record: ReplayExecutionEligibilityRecord,
): string {
  return JSON.stringify({
    replay_execution_eligibility_record_id: record.replay_execution_eligibility_record_id,
    replay_sandbox_id:                      record.replay_sandbox_id,
    source_execution_id:                    record.source_execution_id,
    reconstructed_capability_id:            record.reconstructed_capability_id,
    replay_execution_eligibility_state:     record.replay_execution_eligibility_state,
    reason:                                   record.reason,
    blocking_cause:                           record.blocking_cause,
    replay_execution_eligibility_ttl_ms:      record.replay_execution_eligibility_ttl_ms,
  });
}
