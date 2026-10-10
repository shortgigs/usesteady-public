/**
 * Bounded replay-namespace trace-line append I/O (single-line append primitive only).
 * @see docs/product/replay-namespace-trace-line-append-implementation-contract-v1.md
 */

import {
  isReplayNamespaceTraceLineAppendScope,
  REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE,
  REPLAY_WORKER_PER_SCOPE_IO_VERSION,
} from "./constants.js";
import { isReplayWorkerPerScopeIoEligibilityExpired } from "./expire.js";
import { validateTraceLine } from "./line.js";
import { replayWorkerPerScopeIoId } from "./record-id.js";
import { appendReplayNamespaceTraceLineToStore } from "./store.js";
import { validateReplayTraceTarget } from "./target.js";
import type {
  AppendReplayNamespaceTraceLineInput,
  AppendReplayNamespaceTraceLineResult,
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
  readonly normalized_target: string;
};

function decideIo(input: {
  readonly operator_confirmation: boolean;
  readonly eligibility_state: string;
  readonly eligibility_expired: boolean;
  readonly mutation_scope: string;
  readonly target_validation: ReturnType<typeof validateReplayTraceTarget>;
  readonly line_validation: ReturnType<typeof validateTraceLine>;
}): IoDecision {
  const blocked = (
    state: ReplayWorkerPerScopeIoState,
    reason: string,
    kind: ReplayWorkerPerScopeIoLineageEntry["kind"],
  ): IoDecision => ({
    replay_worker_per_scope_io_state:  state,
    replay_worker_per_scope_io_reason: reason,
    lineage_kind:                      kind,
    append_line:                       false,
    normalized_target:                 "",
  });

  if (input.operator_confirmation !== true) {
    return blocked(
      "blocked",
      "Replay namespace trace append requires operator_confirmation: true.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (input.eligibility_expired) {
    return blocked(
      "expired",
      "Replay worker per-scope I/O eligibility TTL has expired at append time.",
      "replay_worker_per_scope_io_expired",
    );
  }

  if (input.eligibility_state === "expired") {
    return blocked(
      "expired",
      "Replay worker per-scope I/O eligibility was expired.",
      "replay_worker_per_scope_io_expired",
    );
  }

  if (input.eligibility_state === "blocked") {
    return blocked(
      "blocked",
      "Replay worker per-scope I/O eligibility was blocked.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (input.eligibility_state !== "allowed") {
    return blocked(
      "blocked",
      "Replay namespace trace I/O policy fail-closed.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (input.mutation_scope !== REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE) {
    return blocked(
      "blocked",
      "Per-scope I/O scope must exactly match replay_namespace_trace_line_append.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (!isReplayNamespaceTraceLineAppendScope(input.mutation_scope)) {
    return blocked(
      "blocked",
      "Replay namespace trace-line append scope is required.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (!input.target_validation.ok) {
    return blocked(
      "blocked",
      input.target_validation.reason,
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (!input.line_validation.ok) {
    return blocked(
      "blocked",
      input.line_validation.reason,
      "replay_worker_per_scope_io_blocked",
    );
  }

  return {
    replay_worker_per_scope_io_state:  "applied",
    replay_worker_per_scope_io_reason:
      "Replay namespace trace line appended (single-line append-only — no rewrite/truncate/delete/replace).",
    lineage_kind:    "replay_worker_per_scope_io_applied",
    append_line:     true,
    normalized_target: input.target_validation.normalized_target,
  };
}

function buildLineage(
  created_at: string,
  decision: IoDecision,
  target: string,
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
        kind: "replay_namespace_trace_line_appended",
        note: target,
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
 * Append exactly one trace line to one replay trace artifact when gates pass.
 */
export function appendReplayNamespaceTraceLine(
  input: AppendReplayNamespaceTraceLineInput,
): AppendReplayNamespaceTraceLineResult {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const eligibility = input.replay_worker_per_scope_io_eligibility;
  const scope: ReplayWorkerPerScopeIoScope = REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE;

  const target_validation = validateReplayTraceTarget(input.replay_trace_target);
  const line_validation = validateTraceLine(input.trace_line);

  const decision = decideIo({
    operator_confirmation: input.operator_confirmation === true,
    eligibility_state:     eligibility.replay_worker_per_scope_io_eligibility_state,
    eligibility_expired:     isReplayWorkerPerScopeIoEligibilityExpired(eligibility, now),
    mutation_scope:        eligibility.replay_worker_mutation_scope,
    target_validation,
    line_validation,
  });

  const targetForRecord =
    decision.normalized_target.length > 0
      ? decision.normalized_target
      : input.replay_trace_target.trim();

  const replay_execution_id = eligibility.replay_execution_id.trim();

  const io_id = replayWorkerPerScopeIoId({
    replay_execution_id,
    replay_worker_per_scope_io_scope:   scope,
    replay_trace_target:                targetForRecord,
    replay_worker_per_scope_io_state:   decision.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_version: REPLAY_WORKER_PER_SCOPE_IO_VERSION,
  });

  let trace_line_id = "";
  let append_idempotent = false;

  if (decision.append_line && line_validation.ok) {
    const line = line_validation.line;
    const recorded_at = line.recorded_at ?? created_at;
    const storeResult = appendReplayNamespaceTraceLineToStore(
      {
        job_id:                    eligibility.job_id.trim(),
        replay_worker_mutation_id: eligibility.replay_worker_mutation_id.trim(),
        replay_execution_id,
        replay_trace_target:       targetForRecord,
        line_kind:                 line.line_kind,
        message:                   line.message,
        recorded_at,
      },
      io_id,
    );
    trace_line_id = storeResult.entry.trace_line_id;
    append_idempotent = storeResult.append_idempotent;
  }

  const io: ReplayWorkerPerScopeIoRecord = {
    job_id:                    eligibility.job_id.trim(),
    replay_worker_mutation_id: eligibility.replay_worker_mutation_id.trim(),
    replay_worker_side_effect_id: eligibility.replay_worker_side_effect_id.trim(),
    replay_worker_execution_id:   eligibility.replay_worker_execution_id.trim(),
    replay_execution_id,
    replay_trace_target:         targetForRecord,
    replay_worker_per_scope_io_state:  decision.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_scope:    scope,
    replay_worker_per_scope_io_created_at: created_at,
    replay_worker_per_scope_io_version:    REPLAY_WORKER_PER_SCOPE_IO_VERSION,
    replay_worker_per_scope_io_reason:     decision.replay_worker_per_scope_io_reason,
    replay_worker_per_scope_io_lineage:    buildLineage(created_at, decision, targetForRecord),
    replay_worker_per_scope_io_id: io_id,
  };

  return { io, trace_line_id, append_idempotent };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerPerScopeIoOutcomeFingerprint(
  record: ReplayWorkerPerScopeIoRecord,
): string {
  return JSON.stringify({
    replay_worker_per_scope_io_id:     record.replay_worker_per_scope_io_id,
    replay_execution_id:               record.replay_execution_id,
    replay_trace_target:               record.replay_trace_target,
    replay_worker_mutation_id:         record.replay_worker_mutation_id,
    replay_worker_per_scope_io_state:    record.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_scope:      record.replay_worker_per_scope_io_scope,
    replay_worker_per_scope_io_version:    record.replay_worker_per_scope_io_version,
    replay_worker_per_scope_io_reason:     record.replay_worker_per_scope_io_reason,
  });
}
