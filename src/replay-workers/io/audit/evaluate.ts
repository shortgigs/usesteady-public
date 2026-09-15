/**
 * Pure replay namespace audit per-scope I/O eligibility evaluator.
 * @see docs/product/replay-namespace-audit-append-only-implementation-contract-v1.md
 */

import type { ReplayWorkerMutationRecord, ReplayWorkerMutationState } from "../../mutation/types.js";
import {
  isReplayNamespaceAuditAppendOnlyScope,
  REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE,
  REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS,
} from "./constants.js";
import { replayWorkerPerScopeIoEligibilityId } from "./record-id.js";
import type {
  EvaluateReplayWorkerPerScopeIoEligibilityInput,
  ReplayWorkerPerScopeIoEligibilityLineageEntry,
  ReplayWorkerPerScopeIoEligibilityRecord,
  ReplayWorkerPerScopeIoEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isKnownMutationState(state: string): state is ReplayWorkerMutationState {
  return state === "recorded" || state === "blocked" || state === "expired";
}

function isMutationIncomplete(mutation: ReplayWorkerMutationRecord): boolean {
  return (
    mutation.replay_worker_mutation_id.trim().length === 0 ||
    mutation.replay_worker_side_effect_id.trim().length === 0 ||
    mutation.replay_worker_execution_id.trim().length === 0 ||
    mutation.replay_worker_dispatch_id.trim().length === 0 ||
    mutation.replay_execution_id.trim().length === 0 ||
    mutation.job_id.trim().length === 0 ||
    mutation.replay_worker_mutation_created_at.trim().length === 0
  );
}

type EligibilityDecision = {
  readonly replay_worker_per_scope_io_eligibility_state: ReplayWorkerPerScopeIoEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideIoEligibility(
  mutation: ReplayWorkerMutationRecord,
  now: Date,
  ttl_ms: number,
): EligibilityDecision {
  if (isMutationIncomplete(mutation)) {
    return {
      replay_worker_per_scope_io_eligibility_state: "blocked",
      reason:         "Replay worker mutation record is incomplete.",
      blocking_cause: "record_incomplete",
    };
  }

  if (!isKnownMutationState(mutation.replay_worker_mutation_state)) {
    return {
      replay_worker_per_scope_io_eligibility_state: "blocked",
      reason:         "Replay namespace audit I/O eligibility policy fail-closed.",
      blocking_cause: "policy_ambiguous",
    };
  }

  if (mutation.replay_worker_mutation_scope !== REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE) {
    return {
      replay_worker_per_scope_io_eligibility_state: "blocked",
      reason:         "Per-scope I/O scope must exactly match replay_namespace_audit_append_only.",
      blocking_cause: "scope_mismatch",
    };
  }

  if (!isReplayNamespaceAuditAppendOnlyScope(mutation.replay_worker_mutation_scope)) {
    return {
      replay_worker_per_scope_io_eligibility_state: "blocked",
      reason:         "Replay worker mutation scope is not audit append-only.",
      blocking_cause: "scope_mismatch",
    };
  }

  if (mutation.replay_worker_mutation_state === "blocked") {
    return {
      replay_worker_per_scope_io_eligibility_state: "blocked",
      reason:         mutation.replay_worker_mutation_reason,
      blocking_cause: "mutation_blocked",
    };
  }

  if (mutation.replay_worker_mutation_state === "expired") {
    return {
      replay_worker_per_scope_io_eligibility_state: "expired",
      reason:         mutation.replay_worker_mutation_reason,
      blocking_cause: "mutation_expired",
    };
  }

  const mutation_created = Date.parse(mutation.replay_worker_mutation_created_at);
  if (Number.isNaN(mutation_created) || now.getTime() > mutation_created + ttl_ms) {
    return {
      replay_worker_per_scope_io_eligibility_state: "expired",
      reason:         "Replay worker per-scope I/O eligibility TTL has elapsed since mutation.",
      blocking_cause: "io_eligibility_ttl_expired",
    };
  }

  if (mutation.replay_worker_mutation_state !== "recorded") {
    return {
      replay_worker_per_scope_io_eligibility_state: "blocked",
      reason:         "Replay worker mutation was not in recorded state.",
      blocking_cause: "mutation_not_recorded",
    };
  }

  return {
    replay_worker_per_scope_io_eligibility_state: "allowed",
    reason:         "Replay worker mutation is eligible for replay-namespace audit append-only I/O.",
    blocking_cause: "none",
  };
}

function buildRecord(input: {
  readonly mutation: ReplayWorkerMutationRecord;
  readonly decision: EligibilityDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ReplayWorkerPerScopeIoEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ReplayWorkerPerScopeIoEligibilityLineageEntry[] = [
    {
      at:   input.checked_at,
      kind: "evaluated",
      replay_worker_per_scope_io_eligibility_state:
        input.decision.replay_worker_per_scope_io_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    },
  ];

  const replay_worker_mutation_id = input.mutation.replay_worker_mutation_id.trim();
  const replay_execution_id = input.mutation.replay_execution_id.trim();

  return {
    job_id: input.mutation.job_id.trim(),
    replay_worker_mutation_id,
    replay_worker_side_effect_id: input.mutation.replay_worker_side_effect_id.trim(),
    replay_worker_execution_id:   input.mutation.replay_worker_execution_id.trim(),
    replay_worker_dispatch_id:    input.mutation.replay_worker_dispatch_id.trim(),
    replay_execution_id,
    replay_worker_mutation_scope: input.mutation.replay_worker_mutation_scope,
    replay_worker_per_scope_io_eligibility_state:
      input.decision.replay_worker_per_scope_io_eligibility_state,
    replay_worker_per_scope_io_eligibility_checked_at: input.checked_at,
    replay_worker_per_scope_io_eligibility_ttl_ms:      input.ttl_ms,
    replay_worker_per_scope_io_eligibility_expires_at:  expires_at,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
    lineage,
    replay_worker_per_scope_io_eligibility_id: replayWorkerPerScopeIoEligibilityId({
      replay_worker_mutation_id,
      replay_execution_id,
      replay_worker_per_scope_io_eligibility_state:
        input.decision.replay_worker_per_scope_io_eligibility_state,
      reason:         input.decision.reason,
      blocking_cause: input.decision.blocking_cause,
    }),
  };
}

/**
 * Pure evaluator — ReplayWorkerMutationRecord only; no I/O.
 */
export function evaluateReplayWorkerPerScopeIoEligibility(
  input: EvaluateReplayWorkerPerScopeIoEligibilityInput,
): ReplayWorkerPerScopeIoEligibilityRecord {
  const now = input.now ?? new Date();
  const checked_at = now.toISOString();
  const ttl_ms =
    input.replay_worker_per_scope_io_eligibility_ttl_ms ??
    REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS;
  const decision = decideIoEligibility(input.replay_worker_mutation, now, ttl_ms);

  return buildRecord({
    mutation: input.replay_worker_mutation,
    decision,
    checked_at,
    ttl_ms,
  });
}
