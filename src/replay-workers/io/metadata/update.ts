/**
 * Bounded replay-namespace single-path metadata update (metadata sidecar only).
 * @see docs/product/replay-namespace-single-path-metadata-implementation-contract-v1.md
 */

import {
  isReplayNamespaceSinglePathMetadataScope,
  REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE,
  REPLAY_WORKER_PER_SCOPE_IO_VERSION,
} from "./constants.js";
import { isReplayWorkerPerScopeIoEligibilityExpired } from "./expire.js";
import { validateMetadataPatch } from "./patch.js";
import { validateReplayNamespacePath } from "./path.js";
import { replayWorkerPerScopeIoId } from "./record-id.js";
import { setReplayNamespacePathMetadata } from "./store.js";
import type {
  ReplayWorkerPerScopeIoLineageEntry,
  ReplayWorkerPerScopeIoRecord,
  ReplayWorkerPerScopeIoScope,
  ReplayWorkerPerScopeIoState,
  UpdateReplayNamespaceSinglePathMetadataInput,
} from "./types.js";

type IoDecision = {
  readonly replay_worker_per_scope_io_state: ReplayWorkerPerScopeIoState;
  readonly replay_worker_per_scope_io_reason: string;
  readonly lineage_kind: ReplayWorkerPerScopeIoLineageEntry["kind"];
  readonly apply_metadata: boolean;
  readonly normalized_path: string;
};

function decideIo(input: {
  readonly operator_confirmation: boolean;
  readonly eligibility_state: string;
  readonly eligibility_expired: boolean;
  readonly mutation_scope: string;
  readonly path_validation: ReturnType<typeof validateReplayNamespacePath>;
  readonly patch_validation: ReturnType<typeof validateMetadataPatch>;
}): IoDecision {
  const blocked = (
    state: ReplayWorkerPerScopeIoState,
    reason: string,
    kind: ReplayWorkerPerScopeIoLineageEntry["kind"],
  ): IoDecision => ({
    replay_worker_per_scope_io_state:   state,
    replay_worker_per_scope_io_reason:  reason,
    lineage_kind:                       kind,
    apply_metadata:                     false,
    normalized_path:                    "",
  });

  if (input.operator_confirmation !== true) {
    return blocked(
      "blocked",
      "Replay namespace metadata update requires operator_confirmation: true.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (input.eligibility_expired) {
    return blocked(
      "expired",
      "Replay worker per-scope I/O eligibility TTL has expired at update time.",
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
      "Replay namespace metadata I/O policy fail-closed.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (input.mutation_scope !== REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE) {
    return blocked(
      "blocked",
      "Per-scope I/O scope must exactly match replay_namespace_single_path_metadata.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (!isReplayNamespaceSinglePathMetadataScope(input.mutation_scope)) {
    return blocked(
      "blocked",
      "Replay namespace single-path metadata scope is required.",
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (!input.path_validation.ok) {
    return blocked(
      "blocked",
      input.path_validation.reason,
      "replay_worker_per_scope_io_blocked",
    );
  }

  if (!input.patch_validation.ok) {
    return blocked(
      "blocked",
      input.patch_validation.reason,
      "replay_worker_per_scope_io_blocked",
    );
  }

  return {
    replay_worker_per_scope_io_state:  "applied",
    replay_worker_per_scope_io_reason:
      "Replay namespace path metadata updated (metadata fields only — no file content mutation).",
    lineage_kind:    "replay_worker_per_scope_io_applied",
    apply_metadata:  true,
    normalized_path: input.path_validation.normalized_path,
  };
}

function buildLineage(
  created_at: string,
  decision: IoDecision,
  path: string,
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
        kind: "replay_namespace_single_path_metadata_updated",
        note: path,
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
 * Update metadata sidecar for exactly one replay-namespace path — no content/append/delete/rename/move.
 */
export function updateReplayNamespaceSinglePathMetadata(
  input: UpdateReplayNamespaceSinglePathMetadataInput,
): ReplayWorkerPerScopeIoRecord {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const eligibility = input.replay_worker_per_scope_io_eligibility;
  const scope: ReplayWorkerPerScopeIoScope = REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE;

  const path_validation = validateReplayNamespacePath(input.replay_namespace_path);
  const patch_validation = validateMetadataPatch(input.metadata_patch);

  const decision = decideIo({
    operator_confirmation: input.operator_confirmation === true,
    eligibility_state:     eligibility.replay_worker_per_scope_io_eligibility_state,
    eligibility_expired:     isReplayWorkerPerScopeIoEligibilityExpired(eligibility, now),
    mutation_scope:        eligibility.replay_worker_mutation_scope,
    path_validation,
    patch_validation,
  });

  const pathForRecord =
    decision.normalized_path.length > 0
      ? decision.normalized_path
      : input.replay_namespace_path.trim();

  const replay_execution_id = eligibility.replay_execution_id.trim();

  if (decision.apply_metadata && patch_validation.ok) {
    setReplayNamespacePathMetadata(
      pathForRecord,
      patch_validation.patch,
      created_at,
    );
  }

  return {
    job_id:                    eligibility.job_id.trim(),
    replay_worker_mutation_id: eligibility.replay_worker_mutation_id.trim(),
    replay_worker_side_effect_id: eligibility.replay_worker_side_effect_id.trim(),
    replay_worker_execution_id:   eligibility.replay_worker_execution_id.trim(),
    replay_execution_id,
    replay_namespace_path:       pathForRecord,
    replay_worker_per_scope_io_state:  decision.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_scope:    scope,
    replay_worker_per_scope_io_created_at: created_at,
    replay_worker_per_scope_io_version:    REPLAY_WORKER_PER_SCOPE_IO_VERSION,
    replay_worker_per_scope_io_reason:     decision.replay_worker_per_scope_io_reason,
    replay_worker_per_scope_io_lineage:    buildLineage(created_at, decision, pathForRecord),
    replay_worker_per_scope_io_id: replayWorkerPerScopeIoId({
      replay_execution_id,
      replay_worker_per_scope_io_scope:   scope,
      replay_namespace_path:              pathForRecord,
      replay_worker_per_scope_io_state:   decision.replay_worker_per_scope_io_state,
      replay_worker_per_scope_io_version: REPLAY_WORKER_PER_SCOPE_IO_VERSION,
    }),
  };
}

/** Stable outcome fingerprint (excludes created_at and lineage). */
export function replayWorkerPerScopeIoOutcomeFingerprint(
  record: ReplayWorkerPerScopeIoRecord,
): string {
  return JSON.stringify({
    replay_worker_per_scope_io_id:     record.replay_worker_per_scope_io_id,
    replay_execution_id:               record.replay_execution_id,
    replay_namespace_path:             record.replay_namespace_path,
    replay_worker_mutation_id:         record.replay_worker_mutation_id,
    replay_worker_per_scope_io_state:    record.replay_worker_per_scope_io_state,
    replay_worker_per_scope_io_scope:      record.replay_worker_per_scope_io_scope,
    replay_worker_per_scope_io_version:    record.replay_worker_per_scope_io_version,
    replay_worker_per_scope_io_reason:     record.replay_worker_per_scope_io_reason,
  });
}
