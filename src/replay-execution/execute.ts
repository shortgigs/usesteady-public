/**
 * Pure production replay execution recorder (no handler/worker side effects).
 * @see docs/product/production-replay-execution-implementation-contract-v1.md
 */

import { isReplayExecutionEligibilityExpired } from "./eligibility/expire.js";
import type { ReplayExecutionEligibilityRecord } from "./eligibility/types.js";
import { REPLAY_EXECUTION_VERSION } from "./constants.js";
import { replayExecutionId } from "./replay-id.js";
import type { ReplaySandboxCandidate } from "../replay-sandbox/types.js";
import type {
  ExecuteReplaySandboxCandidateInput,
  ReplayExecutionLineageEntry,
  ReplayExecutionRecord,
  ReplayExecutionState,
} from "./types.js";
import { ReplayExecutionRejectedError } from "./types.js";

type ExecutionDecision = {
  readonly replay_execution_state: ReplayExecutionState;
  readonly replay_execution_reason: string;
};

function isRecordIncomplete(
  candidate: ReplaySandboxCandidate,
  eligibility: ReplayExecutionEligibilityRecord,
): boolean {
  return (
    candidate.replay_sandbox_id.trim().length === 0 ||
    candidate.execution_id.trim().length === 0 ||
    eligibility.replay_sandbox_id.trim().length === 0 ||
    eligibility.replay_execution_eligibility_record_id.trim().length === 0
  );
}

function decideReplayExecution(
  candidate: ReplaySandboxCandidate,
  eligibility: ReplayExecutionEligibilityRecord,
  now: Date,
): ExecutionDecision {
  if (isRecordIncomplete(candidate, eligibility)) {
    return {
      replay_execution_state:  "blocked",
      replay_execution_reason: "Replay sandbox or eligibility record is incomplete.",
    };
  }

  if (candidate.replay_sandbox_id.trim() !== eligibility.replay_sandbox_id.trim()) {
    return {
      replay_execution_state:  "blocked",
      replay_execution_reason: "Replay sandbox identity does not match eligibility record.",
    };
  }

  if (
    eligibility.replay_execution_eligibility_state === "expired" ||
    isReplayExecutionEligibilityExpired(eligibility, now)
  ) {
    return {
      replay_execution_state:  "expired",
      replay_execution_reason: "Replay execution eligibility has expired.",
    };
  }

  if (eligibility.replay_execution_eligibility_state === "blocked") {
    return {
      replay_execution_state:  "blocked",
      replay_execution_reason: "Replay execution eligibility is blocked.",
    };
  }

  if (candidate.replay_state !== "candidate") {
    return {
      replay_execution_state:  "blocked",
      replay_execution_reason: "Replay sandbox candidate is not eligible for execution.",
    };
  }

  if (eligibility.replay_execution_eligibility_state !== "allowed") {
    return {
      replay_execution_state:  "blocked",
      replay_execution_reason: "Replay execution policy fail-closed.",
    };
  }

  return {
    replay_execution_state:  "executed",
    replay_execution_reason: "Replay execution recorded under isolated lineage (no production side effects).",
  };
}

function buildLineage(
  created_at: string,
  state: ReplayExecutionState,
  reason: string,
): readonly ReplayExecutionLineageEntry[] {
  const base = { at: created_at } as const;

  if (state === "executed") {
    return [
      { ...base, kind: "replay_gate_passed" },
      { ...base, kind: "replay_execution_started" },
      { ...base, kind: "replay_execution_completed", note: reason },
    ];
  }

  if (state === "expired") {
    return [
      { ...base, kind: "replay_execution_started" },
      { ...base, kind: "replay_execution_expired", note: reason },
    ];
  }

  return [
    { ...base, kind: "replay_execution_started" },
    { ...base, kind: "replay_execution_blocked", note: reason },
  ];
}

function buildRecord(input: {
  readonly replay_sandbox_id: string;
  readonly decision: ExecutionDecision;
  readonly created_at: string;
}): ReplayExecutionRecord {
  const replay_sandbox_id = input.replay_sandbox_id.trim();

  return {
    replay_sandbox_id,
    replay_execution_state:       input.decision.replay_execution_state,
    replay_execution_created_at: input.created_at,
    replay_execution_version:     REPLAY_EXECUTION_VERSION,
    replay_execution_reason:      input.decision.replay_execution_reason,
    replay_execution_lineage:     buildLineage(
      input.created_at,
      input.decision.replay_execution_state,
      input.decision.replay_execution_reason,
    ),
    replay_execution_id: replayExecutionId({
      replay_sandbox_id,
      replay_execution_state: input.decision.replay_execution_state,
      replay_execution_version: REPLAY_EXECUTION_VERSION,
    }),
  };
}

/**
 * Record-only replay execution — no workers, handlers, filesystem, or network.
 */
export function executeReplaySandboxCandidate(
  input: ExecuteReplaySandboxCandidateInput,
): ReplayExecutionRecord {
  if (input.operator_confirmation !== true) {
    throw new ReplayExecutionRejectedError(
      "operator_confirmation_required",
      "Replay execution requires explicit operator_confirmation: true.",
    );
  }

  const now = input.now ?? new Date();
  const created_at = input.replay_execution_created_at ?? now.toISOString();
  const decision = decideReplayExecution(
    input.replay_candidate,
    input.replay_execution_eligibility,
    now,
  );

  return buildRecord({
    replay_sandbox_id: input.replay_candidate.replay_sandbox_id,
    decision,
    created_at,
  });
}

/** Stable outcome fingerprint (excludes created_at and lineage timestamps in id). */
export function replayExecutionOutcomeFingerprint(
  record: ReplayExecutionRecord,
): string {
  return JSON.stringify({
    replay_execution_id:     record.replay_execution_id,
    replay_sandbox_id:       record.replay_sandbox_id,
    replay_execution_state:  record.replay_execution_state,
    replay_execution_version: record.replay_execution_version,
    replay_execution_reason: record.replay_execution_reason,
  });
}
