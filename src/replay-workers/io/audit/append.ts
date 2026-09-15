/**
 * Bounded replay-namespace audit append-only I/O (append primitive only).
 * @see docs/product/replay-namespace-audit-append-only-implementation-contract-v1.md
 */

import {
  isReplayNamespaceAuditAppendOnlyScope,
  REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE,
  REPLAY_NAMESPACE_AUDIT_LINE_MESSAGE_MAX,
  REPLAY_WORKER_PER_SCOPE_IO_VERSION,
} from "./constants.js";
import { isReplayWorkerPerScopeIoEligibilityExpired } from "./expire.js";
import { replayWorkerPerScopeIoId } from "./record-id.js";
import { appendReplayNamespaceAuditLineToStore } from "./store.js";
import type {
  AppendReplayNamespaceAuditLineInput,
  ReplayNamespaceAuditLinePayload,
  ReplayWorkerPerScopeIoLineageEntry,
  ReplayWorkerPerScopeIoRecord,
  ReplayWorkerPerScopeIoScope,
  ReplayWorkerPerScopeIoState,
} from "./types.js";

type IoDecision = {
  readonly replay_worker_per_scope_io_state: ReplayWorkerPerScopeIoState;
  readonly replay_worker_per_scope_io_reason: string;
  readonly lineage_kind: ReplayWorkerPerScopeIoLineageEntry["kind"];
  readonly append_line: boolean;
};

function defaultAuditMessage(eligibility: {
  readonly replay_worker_mutation_id: string;
  readonly replay_execution_id: string;
}): string {
  return `replay_namespace_audit_append mutation=${eligibility.replay_worker_mutation_id} execution=${eligibility.replay_execution_id}`;
}

function decideIo(input: {
  readonly operator_confirmation: boolean;
  readonly eligibility_state: string;
  readonly eligibility_expired: boolean;
  readonly mutation_scope: string;
}): IoDecision {
  if (input.operator_confirmation !== true) {
    return {
      replay_worker_per_scope_io_state: "blocked",
      replay_worker_per_scope_io_reason:
        "Replay namespace audit append requires operator_confirmation: true.",
      lineage_kind: "replay_worker_per_scope_io_blocked",
      append_line: false,
    };
  }

  if (input.eligibility_expired) {
    return {
      replay_worker_per_scope_io_state: "expired",
      replay_worker_per_scope_io_reason:
        "Replay worker per-scope I/O eligibility TTL has expired at append time.",
      lineage_kind: "replay_worker_per_scope_io_expired",
      append_line: false,
    };
  }

  if (input.eligibility_state === "expired") {
    return {
      replay_worker_per_scope_io_state: "expired",
      replay_worker_per_scope_io_reason:
        "Replay worker per-scope I/O eligibility was expired.",
      lineage_kind: "replay_worker_per_scope_io_expired",
      append_line: false,
    };
  }

  if (input.eligibility_state === "blocked") {
    return {
      replay_worker_per_scope_io_state: "blocked",
      replay_worker_per_scope_io_reason:
        "Replay worker per-scope I/O eligibility was blocked.",
      lineage_kind: "replay_worker_per_scope_io_blocked",
      append_line: false,
    };
  }

  if (input.eligibility_state !== "allowed") {
    return {
      replay_worker_per_scope_io_state: "blocked",
      replay_worker_per_scope_io_reason:
        "Replay namespace audit I/O policy fail-closed.",
      lineage_kind: "replay_worker_per_scope_io_blocked",
      append_line: false,
    };
  }

  if (input.mutation_scope !== REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE) {
    return {
      replay_worker_per_scope_io_state: "blocked",
      replay_worker_per_scope_io_reason:
        "Per-scope I/O scope must exactly match replay_namespace_audit_append_only.",
      lineage_kind: "replay_worker_per_scope_io_blocked",
      append_line: false,
    };
  }

  if (!isReplayNamespaceAuditAppendOnlyScope(input.mutation_scope)) {
    return {
      replay_worker_per_scope_io_state: "blocked",
      replay_worker_per_scope_io_reason:
        "Replay namespace audit append-only scope is required.",
      lineage_kind: "replay_worker_per_scope_io_blocked",
      append_line: false,
    };
  }

  return {
    replay_worker_per_scope_io_state: "applied",
    replay_worker_per_scope_io_reason:
      "Replay namespace audit line appended (append-only — no overwrite/delete/truncate).",
    lineage_kind: "replay_worker_per_scope_io_applied",
    append_line: true,
  };
}

function buildLineage(
  created_at: string,
  decision: IoDecision,
): readonly ReplayWorkerPerScopeIoLineageEntry[] {
  const requested: ReplayWorkerPerScopeIoLineageEntry = {
    at:   created_at,
    kind: "replay_worker_per_scope_io_requested",
  };

  if (decision.replay_worker_per_scope_io_state === "applied") {
    return [
      requested,
      {
        at:   created_at,
        kind: "replay_namespace_audit_line_appended",
        note: REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE,
      },
      {
        at:   created_at,
        kind: "replay_worker_per_scope_io_applied",
        note: decision.replay_worker_per_scope_io_reason,
      },
    ];
  }

  return [
    requested,
    {
      at:   created_at,
      kind: decision.lineage_kind,
      note: decision.replay_worker_per_scope_io_reason,
    },
  ];
}

/**
 * Append one replay-namespace audit line when gates pass; never overwrite/delete/truncate.
 */
export function appendReplayNamespaceAuditLine(
  input: AppendReplayNamespaceAuditLineInput,
): ReplayWorkerPerScopeIoRecord {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const eligibility = input.replay_worker_per_scope_io_eligibility;
  const scope: ReplayWorkerPerScopeIoScope = REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE;

  const decision = decideIo({
    operator_confirmation: input.operator_confirmation === true,
    eligibility_state:   eligibility.replay_worker_per_scope_io_eligibility_state,
    eligibility_expired: isReplayWorkerPerScopeIoEligibilityExpired(eligibility, now),
    mutation_scope:      eligibility.replay_worker_mutation_scope,
  });

  const replay_execution_id = eligibility.replay_execution_id.trim();

  const io_id = replayWorkerPerScopeIoId({
    replay_execution_id,
    replay_worker_per_scope_io_scope:   scope,
    replay_worker_per_scope_io_state: decision.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_version: REPLAY_WORKER_PER_SCOPE_IO_VERSION,
  });

  if (decision.append_line) {
    const message = defaultAuditMessage(eligibility).slice(
      0,
      REPLAY_NAMESPACE_AUDIT_LINE_MESSAGE_MAX,
    );
    const payload: ReplayNamespaceAuditLinePayload = {
      job_id:                    eligibility.job_id.trim(),
      replay_worker_mutation_id: eligibility.replay_worker_mutation_id.trim(),
      replay_execution_id,
      line_kind:   "replay_namespace_audit_append",
      message,
      recorded_at: created_at,
    };
    appendReplayNamespaceAuditLineToStore(payload, io_id);
  }

  return {
    job_id:                    eligibility.job_id.trim(),
    replay_worker_mutation_id: eligibility.replay_worker_mutation_id.trim(),
    replay_worker_side_effect_id: eligibility.replay_worker_side_effect_id.trim(),
    replay_worker_execution_id:   eligibility.replay_worker_execution_id.trim(),
    replay_execution_id,
    replay_worker_per_scope_io_state:  decision.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_scope:    scope,
    replay_worker_per_scope_io_created_at: created_at,
    replay_worker_per_scope_io_version:    REPLAY_WORKER_PER_SCOPE_IO_VERSION,
    replay_worker_per_scope_io_reason:     decision.replay_worker_per_scope_io_reason,
    replay_worker_per_scope_io_lineage:    buildLineage(created_at, decision),
    replay_worker_per_scope_io_id: io_id,
  };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerPerScopeIoOutcomeFingerprint(
  record: ReplayWorkerPerScopeIoRecord,
): string {
  return JSON.stringify({
    replay_worker_per_scope_io_id:     record.replay_worker_per_scope_io_id,
    replay_execution_id:               record.replay_execution_id,
    replay_worker_mutation_id:         record.replay_worker_mutation_id,
    replay_worker_per_scope_io_state:    record.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_scope:      record.replay_worker_per_scope_io_scope,
    replay_worker_per_scope_io_version:    record.replay_worker_per_scope_io_version,
    replay_worker_per_scope_io_reason:     record.replay_worker_per_scope_io_reason,
  });
}
