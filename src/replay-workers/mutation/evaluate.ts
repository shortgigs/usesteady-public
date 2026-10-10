/**
 * Pure replay worker mutation eligibility evaluator.
 * @see docs/product/replay-worker-bounded-mutation-runtime-contract-v1.md
 */

import type { ReplayWorkerSideEffectRecord, ReplayWorkerSideEffectState } from "../side-effect/types.js";
import { REPLAY_WORKER_MUTATION_ELIGIBILITY_TTL_MS } from "./constants.js";
import { replayWorkerMutationEligibilityId } from "./record-id.js";
import type {
  EvaluateReplayWorkerMutationEligibilityInput,
  ReplayWorkerMutationEligibilityLineageEntry,
  ReplayWorkerMutationEligibilityRecord,
  ReplayWorkerMutationEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isKnownSideEffectState(
  state: string,
): state is ReplayWorkerSideEffectState {
  return state === "recorded" || state === "blocked" || state === "expired";
}

function isSideEffectIncomplete(side_effect: ReplayWorkerSideEffectRecord): boolean {
  return (
    side_effect.replay_worker_side_effect_id.trim().length === 0 ||
    side_effect.replay_worker_execution_id.trim().length === 0 ||
    side_effect.replay_worker_dispatch_id.trim().length === 0 ||
    side_effect.replay_execution_id.trim().length === 0 ||
    side_effect.job_id.trim().length === 0 ||
    side_effect.replay_worker_side_effect_created_at.trim().length === 0
  );
}

type EligibilityDecision = {
  readonly replay_worker_mutation_eligibility_state: ReplayWorkerMutationEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideMutationEligibility(
  side_effect: ReplayWorkerSideEffectRecord,
  now: Date,
  ttl_ms: number,
): EligibilityDecision {
  if (isSideEffectIncomplete(side_effect)) {
    return {
      replay_worker_mutation_eligibility_state: "blocked",
      reason:         "Replay worker side-effect record is incomplete.",
      blocking_cause: "record_incomplete",
    };
  }

  const side_effect_state = side_effect.replay_worker_side_effect_state;

  if (!isKnownSideEffectState(side_effect_state)) {
    return {
      replay_worker_mutation_eligibility_state: "blocked",
      reason:         "Replay worker mutation eligibility policy fail-closed.",
      blocking_cause: "policy_ambiguous",
    };
  }

  if (side_effect_state === "blocked") {
    return {
      replay_worker_mutation_eligibility_state: "blocked",
      reason:         side_effect.replay_worker_side_effect_reason,
      blocking_cause: "side_effect_blocked",
    };
  }

  if (side_effect_state === "expired") {
    return {
      replay_worker_mutation_eligibility_state: "expired",
      reason:         side_effect.replay_worker_side_effect_reason,
      blocking_cause: "side_effect_expired",
    };
  }

  const side_effect_created = Date.parse(side_effect.replay_worker_side_effect_created_at);
  if (Number.isNaN(side_effect_created) || now.getTime() > side_effect_created + ttl_ms) {
    return {
      replay_worker_mutation_eligibility_state: "expired",
      reason:         "Replay worker mutation eligibility TTL has elapsed since side effect.",
      blocking_cause: "mutation_eligibility_ttl_expired",
    };
  }

  if (side_effect_state !== "recorded") {
    return {
      replay_worker_mutation_eligibility_state: "blocked",
      reason:         "Replay worker side effect was not in recorded state.",
      blocking_cause: "side_effect_not_recorded",
    };
  }

  return {
    replay_worker_mutation_eligibility_state: "allowed",
    reason:         "Replay worker side effect is eligible for bounded mutation recording.",
    blocking_cause: "none",
  };
}

function buildRecord(input: {
  readonly side_effect: ReplayWorkerSideEffectRecord;
  readonly decision: EligibilityDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ReplayWorkerMutationEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ReplayWorkerMutationEligibilityLineageEntry[] = [
    {
      at:   input.checked_at,
      kind: "evaluated",
      replay_worker_mutation_eligibility_state: input.decision.replay_worker_mutation_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    },
  ];

  const replay_worker_side_effect_id = input.side_effect.replay_worker_side_effect_id.trim();
  const replay_worker_execution_id = input.side_effect.replay_worker_execution_id.trim();
  const replay_worker_dispatch_id = input.side_effect.replay_worker_dispatch_id.trim();
  const replay_execution_id = input.side_effect.replay_execution_id.trim();

  return {
    job_id: input.side_effect.job_id.trim(),
    replay_worker_side_effect_id,
    replay_worker_execution_id,
    replay_worker_dispatch_id,
    replay_execution_id,
    replay_worker_mutation_eligibility_state: input.decision.replay_worker_mutation_eligibility_state,
    replay_worker_mutation_eligibility_checked_at: input.checked_at,
    replay_worker_mutation_eligibility_ttl_ms:      input.ttl_ms,
    replay_worker_mutation_eligibility_expires_at:  expires_at,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
    lineage,
    replay_worker_mutation_eligibility_id: replayWorkerMutationEligibilityId({
      replay_worker_side_effect_id,
      replay_worker_execution_id,
      replay_execution_id,
      replay_worker_mutation_eligibility_state: input.decision.replay_worker_mutation_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    }),
  };
}

/**
 * Pure evaluator — ReplayWorkerSideEffectRecord only; no I/O or mutation.
 */
export function evaluateReplayWorkerMutationEligibility(
  input: EvaluateReplayWorkerMutationEligibilityInput,
): ReplayWorkerMutationEligibilityRecord {
  const now = input.now ?? new Date();
  const checked_at = now.toISOString();
  const ttl_ms =
    input.replay_worker_mutation_eligibility_ttl_ms ??
    REPLAY_WORKER_MUTATION_ELIGIBILITY_TTL_MS;
  const decision = decideMutationEligibility(
    input.replay_worker_side_effect,
    now,
    ttl_ms,
  );

  return buildRecord({
    side_effect: input.replay_worker_side_effect,
    decision,
    checked_at,
    ttl_ms,
  });
}
