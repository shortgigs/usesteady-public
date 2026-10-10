/**
 * Pure bounded replay worker mutation recorder (no I/O, unrestricted mutation, or reruns).
 * @see docs/product/replay-worker-bounded-mutation-runtime-contract-v1.md
 */

import type { ReplayWorkerMutationScope } from "./constants.js";
import {
  isReplayWorkerMutationScope,
  REPLAY_WORKER_MUTATION_VERSION,
} from "./constants.js";
import { isReplayWorkerMutationEligibilityExpired } from "./expire.js";
import { replayWorkerMutationId } from "./record-id.js";
import type {
  ReplayWorkerMutationLineageEntry,
  ReplayWorkerMutationRecord,
  ReplayWorkerMutationState,
  RunBoundedReplayWorkerMutationInput,
} from "./types.js";

type MutationDecision = {
  readonly replay_worker_mutation_state: ReplayWorkerMutationState;
  readonly replay_worker_mutation_reason: string;
  readonly lineage_kind: ReplayWorkerMutationLineageEntry["kind"];
};

function decideMutation(input: {
  readonly operator_confirmation: boolean;
  readonly eligibility_state: string;
  readonly eligibility_expired: boolean;
  readonly scope: string;
  readonly replay_worker_side_effect_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
}): MutationDecision {
  if (input.operator_confirmation !== true) {
    return {
      replay_worker_mutation_state: "blocked",
      replay_worker_mutation_reason:
        "Replay worker mutation requires operator_confirmation: true.",
      lineage_kind: "replay_worker_mutation_blocked",
    };
  }

  if (!isReplayWorkerMutationScope(input.scope)) {
    return {
      replay_worker_mutation_state: "blocked",
      replay_worker_mutation_reason:
        "Replay worker mutation scope is not a v1 bounded scope.",
      lineage_kind: "replay_worker_mutation_blocked",
    };
  }

  if (input.eligibility_expired) {
    return {
      replay_worker_mutation_state: "expired",
      replay_worker_mutation_reason:
        "Replay worker mutation eligibility TTL has expired at mutation time.",
      lineage_kind: "replay_worker_mutation_expired",
    };
  }

  if (input.eligibility_state === "expired") {
    return {
      replay_worker_mutation_state: "expired",
      replay_worker_mutation_reason:
        "Replay worker mutation eligibility was expired.",
      lineage_kind: "replay_worker_mutation_expired",
    };
  }

  if (input.eligibility_state === "blocked") {
    return {
      replay_worker_mutation_state: "blocked",
      replay_worker_mutation_reason:
        "Replay worker mutation eligibility was blocked.",
      lineage_kind: "replay_worker_mutation_blocked",
    };
  }

  if (input.eligibility_state !== "allowed") {
    return {
      replay_worker_mutation_state: "blocked",
      replay_worker_mutation_reason:
        "Replay worker mutation policy fail-closed.",
      lineage_kind: "replay_worker_mutation_blocked",
    };
  }

  if (
    input.replay_worker_side_effect_id.trim().length === 0 ||
    input.replay_worker_execution_id.trim().length === 0 ||
    input.replay_worker_dispatch_id.trim().length === 0 ||
    input.replay_execution_id.trim().length === 0
  ) {
    return {
      replay_worker_mutation_state: "blocked",
      replay_worker_mutation_reason:
        "Replay worker mutation eligibility scope is incomplete.",
      lineage_kind: "replay_worker_mutation_blocked",
    };
  }

  return {
    replay_worker_mutation_state: "recorded",
    replay_worker_mutation_reason:
      "Replay worker mutation recorded (bounded intent only — no filesystem or network mutation).",
    lineage_kind: "replay_worker_mutation_recorded",
  };
}

function buildLineage(
  created_at: string,
  decision: MutationDecision,
  scope: ReplayWorkerMutationScope,
): readonly ReplayWorkerMutationLineageEntry[] {
  const requested: ReplayWorkerMutationLineageEntry = {
    at:   created_at,
    kind: "replay_worker_mutation_requested",
  };

  if (decision.replay_worker_mutation_state === "recorded") {
    return [
      requested,
      {
        at:   created_at,
        kind: "replay_worker_mutation_recorded",
        note: scope,
      },
    ];
  }

  return [
    requested,
    {
      at:   created_at,
      kind: decision.lineage_kind,
      note: decision.replay_worker_mutation_reason,
    },
  ];
}

/**
 * Pure mutation recorder — eligibility + confirmation + scope only; no unrestricted mutation.
 */
export function runBoundedReplayWorkerMutation(
  input: RunBoundedReplayWorkerMutationInput,
): ReplayWorkerMutationRecord {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const eligibility = input.replay_worker_mutation_eligibility;
  const scope = input.replay_worker_mutation_scope;

  const decision = decideMutation({
    operator_confirmation:     input.operator_confirmation === true,
    eligibility_state:       eligibility.replay_worker_mutation_eligibility_state,
    eligibility_expired:       isReplayWorkerMutationEligibilityExpired(eligibility, now),
    scope,
    replay_worker_side_effect_id: eligibility.replay_worker_side_effect_id,
    replay_worker_execution_id: eligibility.replay_worker_execution_id,
    replay_worker_dispatch_id:  eligibility.replay_worker_dispatch_id,
    replay_execution_id:        eligibility.replay_execution_id,
  });

  const scopeForRecord: ReplayWorkerMutationScope = isReplayWorkerMutationScope(scope)
    ? scope
    : "replay_namespace_audit_append_only";

  const replay_execution_id = eligibility.replay_execution_id.trim();

  return {
    job_id:                    eligibility.job_id.trim(),
    replay_worker_side_effect_id: eligibility.replay_worker_side_effect_id.trim(),
    replay_worker_execution_id: eligibility.replay_worker_execution_id.trim(),
    replay_worker_dispatch_id:  eligibility.replay_worker_dispatch_id.trim(),
    replay_execution_id,
    replay_worker_mutation_state:  decision.replay_worker_mutation_state,
    replay_worker_mutation_scope:    scopeForRecord,
    replay_worker_mutation_created_at: created_at,
    replay_worker_mutation_version:    REPLAY_WORKER_MUTATION_VERSION,
    replay_worker_mutation_reason:     decision.replay_worker_mutation_reason,
    replay_worker_mutation_lineage:    buildLineage(created_at, decision, scopeForRecord),
    replay_worker_mutation_id: replayWorkerMutationId({
      replay_execution_id,
      replay_worker_mutation_state:  decision.replay_worker_mutation_state,
      replay_worker_mutation_scope:    scopeForRecord,
      replay_worker_mutation_version:  REPLAY_WORKER_MUTATION_VERSION,
    }),
  };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerMutationOutcomeFingerprint(
  record: ReplayWorkerMutationRecord,
): string {
  return JSON.stringify({
    replay_worker_mutation_id:     record.replay_worker_mutation_id,
    replay_execution_id:           record.replay_execution_id,
    replay_worker_side_effect_id:  record.replay_worker_side_effect_id,
    replay_worker_mutation_state:    record.replay_worker_mutation_state,
    replay_worker_mutation_scope:    record.replay_worker_mutation_scope,
    replay_worker_mutation_version:  record.replay_worker_mutation_version,
    replay_worker_mutation_reason:   record.replay_worker_mutation_reason,
  });
}
