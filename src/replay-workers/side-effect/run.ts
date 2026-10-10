/**
 * Pure bounded replay worker side-effect recorder (no I/O, mutation, or reruns).
 * @see docs/product/replay-worker-side-effect-runtime-contract-v1.md
 */

import type { ReplayWorkerSideEffectScope } from "./constants.js";
import {
  isReplayWorkerSideEffectScope,
  REPLAY_WORKER_SIDE_EFFECT_VERSION,
} from "./constants.js";
import { isReplayWorkerSideEffectEligibilityExpired } from "./expire.js";
import { replayWorkerSideEffectId } from "./record-id.js";
import type {
  ReplayWorkerSideEffectLineageEntry,
  ReplayWorkerSideEffectRecord,
  ReplayWorkerSideEffectState,
  RunBoundedReplayWorkerSideEffectInput,
} from "./types.js";

type SideEffectDecision = {
  readonly replay_worker_side_effect_state: ReplayWorkerSideEffectState;
  readonly replay_worker_side_effect_reason: string;
  readonly lineage_kind: ReplayWorkerSideEffectLineageEntry["kind"];
};

function decideSideEffect(input: {
  readonly operator_confirmation: boolean;
  readonly eligibility_state: string;
  readonly eligibility_expired: boolean;
  readonly scope: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
}): SideEffectDecision {
  if (input.operator_confirmation !== true) {
    return {
      replay_worker_side_effect_state: "blocked",
      replay_worker_side_effect_reason:
        "Replay worker side effect requires operator_confirmation: true.",
      lineage_kind: "replay_worker_side_effect_blocked",
    };
  }

  if (!isReplayWorkerSideEffectScope(input.scope)) {
    return {
      replay_worker_side_effect_state: "blocked",
      replay_worker_side_effect_reason:
        "Replay worker side effect scope is not a v1 descriptive scope.",
      lineage_kind: "replay_worker_side_effect_blocked",
    };
  }

  if (input.eligibility_expired) {
    return {
      replay_worker_side_effect_state: "expired",
      replay_worker_side_effect_reason:
        "Replay worker side-effect eligibility TTL has expired at side-effect time.",
      lineage_kind: "replay_worker_side_effect_expired",
    };
  }

  if (input.eligibility_state === "expired") {
    return {
      replay_worker_side_effect_state: "expired",
      replay_worker_side_effect_reason:
        "Replay worker side-effect eligibility was expired.",
      lineage_kind: "replay_worker_side_effect_expired",
    };
  }

  if (input.eligibility_state === "blocked") {
    return {
      replay_worker_side_effect_state: "blocked",
      replay_worker_side_effect_reason:
        "Replay worker side-effect eligibility was blocked.",
      lineage_kind: "replay_worker_side_effect_blocked",
    };
  }

  if (input.eligibility_state !== "allowed") {
    return {
      replay_worker_side_effect_state: "blocked",
      replay_worker_side_effect_reason:
        "Replay worker side-effect policy fail-closed.",
      lineage_kind: "replay_worker_side_effect_blocked",
    };
  }

  if (
    input.replay_worker_execution_id.trim().length === 0 ||
    input.replay_worker_dispatch_id.trim().length === 0 ||
    input.replay_execution_id.trim().length === 0
  ) {
    return {
      replay_worker_side_effect_state: "blocked",
      replay_worker_side_effect_reason:
        "Replay worker side-effect eligibility scope is incomplete.",
      lineage_kind: "replay_worker_side_effect_blocked",
    };
  }

  return {
    replay_worker_side_effect_state: "recorded",
    replay_worker_side_effect_reason:
      "Replay worker side effect recorded (descriptive only — no filesystem or network mutation).",
    lineage_kind: "replay_worker_side_effect_recorded",
  };
}

function buildLineage(
  created_at: string,
  decision: SideEffectDecision,
  scope: ReplayWorkerSideEffectScope,
): readonly ReplayWorkerSideEffectLineageEntry[] {
  const requested: ReplayWorkerSideEffectLineageEntry = {
    at:   created_at,
    kind: "replay_worker_side_effect_requested",
  };

  if (decision.replay_worker_side_effect_state === "recorded") {
    return [
      requested,
      {
        at:   created_at,
        kind: "replay_worker_side_effect_recorded",
        note: scope,
      },
    ];
  }

  return [
    requested,
    {
      at:   created_at,
      kind: decision.lineage_kind,
      note: decision.replay_worker_side_effect_reason,
    },
  ];
}

/**
 * Pure side-effect recorder — eligibility + confirmation + scope only; no mutation.
 */
export function runBoundedReplayWorkerSideEffect(
  input: RunBoundedReplayWorkerSideEffectInput,
): ReplayWorkerSideEffectRecord {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const eligibility = input.replay_worker_side_effect_eligibility;
  const scope = input.replay_worker_side_effect_scope;

  const decision = decideSideEffect({
    operator_confirmation:     input.operator_confirmation === true,
    eligibility_state:       eligibility.replay_worker_side_effect_eligibility_state,
    eligibility_expired:       isReplayWorkerSideEffectEligibilityExpired(eligibility, now),
    scope,
    replay_worker_execution_id: eligibility.replay_worker_execution_id,
    replay_worker_dispatch_id:  eligibility.replay_worker_dispatch_id,
    replay_execution_id:        eligibility.replay_execution_id,
  });

  const scopeForRecord: ReplayWorkerSideEffectScope = isReplayWorkerSideEffectScope(scope)
    ? scope
    : "descriptive_log";

  const replay_execution_id = eligibility.replay_execution_id.trim();

  return {
    job_id:                    eligibility.job_id.trim(),
    replay_worker_execution_id: eligibility.replay_worker_execution_id.trim(),
    replay_worker_dispatch_id:  eligibility.replay_worker_dispatch_id.trim(),
    replay_execution_id,
    replay_worker_side_effect_state:  decision.replay_worker_side_effect_state,
    replay_worker_side_effect_scope:    scopeForRecord,
    replay_worker_side_effect_created_at: created_at,
    replay_worker_side_effect_version:    REPLAY_WORKER_SIDE_EFFECT_VERSION,
    replay_worker_side_effect_reason:     decision.replay_worker_side_effect_reason,
    replay_worker_side_effect_lineage:    buildLineage(created_at, decision, scopeForRecord),
    replay_worker_side_effect_id: replayWorkerSideEffectId({
      replay_execution_id,
      replay_worker_side_effect_state:  decision.replay_worker_side_effect_state,
      replay_worker_side_effect_scope:    scopeForRecord,
      replay_worker_side_effect_version:  REPLAY_WORKER_SIDE_EFFECT_VERSION,
    }),
  };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerSideEffectOutcomeFingerprint(
  record: ReplayWorkerSideEffectRecord,
): string {
  return JSON.stringify({
    replay_worker_side_effect_id:     record.replay_worker_side_effect_id,
    replay_execution_id:              record.replay_execution_id,
    replay_worker_execution_id:       record.replay_worker_execution_id,
    replay_worker_side_effect_state:    record.replay_worker_side_effect_state,
    replay_worker_side_effect_scope:    record.replay_worker_side_effect_scope,
    replay_worker_side_effect_version:  record.replay_worker_side_effect_version,
    replay_worker_side_effect_reason:   record.replay_worker_side_effect_reason,
  });
}
