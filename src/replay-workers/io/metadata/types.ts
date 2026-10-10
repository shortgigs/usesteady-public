/**
 * Replay namespace single-path metadata per-scope I/O types.
 * @see docs/product/replay-namespace-single-path-metadata-implementation-contract-v1.md
 */

import type { ReplayWorkerMutationRecord } from "../../mutation/types.js";
import type {
  AllowedMetadataPatchKey,
  ReplayNamespaceSinglePathMetadataScope,
} from "./constants.js";

export type ReplayWorkerPerScopeIoEligibilityState = "allowed" | "blocked" | "expired";

export type ReplayWorkerPerScopeIoEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated";
  readonly replay_worker_per_scope_io_eligibility_state: ReplayWorkerPerScopeIoEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplayWorkerPerScopeIoEligibilityRecord = {
  readonly replay_worker_per_scope_io_eligibility_id: string;
  readonly job_id: string;
  readonly replay_worker_mutation_id: string;
  readonly replay_worker_side_effect_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_mutation_scope: string;
  readonly replay_worker_per_scope_io_eligibility_state: ReplayWorkerPerScopeIoEligibilityState;
  readonly replay_worker_per_scope_io_eligibility_checked_at: string;
  readonly replay_worker_per_scope_io_eligibility_ttl_ms: number;
  readonly replay_worker_per_scope_io_eligibility_expires_at: string;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ReplayWorkerPerScopeIoEligibilityLineageEntry[];
};

export type EvaluateReplayWorkerPerScopeIoEligibilityInput = {
  readonly replay_worker_mutation: ReplayWorkerMutationRecord;
  readonly now?: Date;
  readonly replay_worker_per_scope_io_eligibility_ttl_ms?: number;
};

export type ReplayWorkerPerScopeIoState = "applied" | "blocked" | "expired";

export type ReplayWorkerPerScopeIoScope = ReplayNamespaceSinglePathMetadataScope;

export type ReplayWorkerPerScopeIoLineageKind =
  | "replay_worker_per_scope_io_requested"
  | "replay_namespace_single_path_metadata_updated"
  | "replay_worker_per_scope_io_applied"
  | "replay_worker_per_scope_io_blocked"
  | "replay_worker_per_scope_io_expired";

export type ReplayWorkerPerScopeIoLineageEntry = {
  readonly at: string;
  readonly kind: ReplayWorkerPerScopeIoLineageKind;
  readonly note?: string;
};

export type ReplayWorkerPerScopeIoRecord = {
  readonly replay_worker_per_scope_io_id: string;
  readonly job_id: string;
  readonly replay_worker_mutation_id: string;
  readonly replay_worker_side_effect_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_execution_id: string;
  readonly replay_namespace_path: string;
  readonly replay_worker_per_scope_io_state: ReplayWorkerPerScopeIoState;
  readonly replay_worker_per_scope_io_scope: ReplayWorkerPerScopeIoScope;
  readonly replay_worker_per_scope_io_created_at: string;
  readonly replay_worker_per_scope_io_version: string;
  readonly replay_worker_per_scope_io_reason: string;
  readonly replay_worker_per_scope_io_lineage: readonly ReplayWorkerPerScopeIoLineageEntry[];
};

export type ReplayNamespaceMetadataPatch = Partial<
  Record<AllowedMetadataPatchKey, string>
>;

export type ReplayNamespacePathMetadataRecord = {
  readonly replay_namespace_path: string;
  readonly replay_namespace_label?: string;
  readonly replay_namespace_note?: string;
  readonly replay_namespace_tag?: string;
  readonly updated_at: string;
};

export type UpdateReplayNamespaceSinglePathMetadataInput = {
  readonly replay_worker_per_scope_io_eligibility: ReplayWorkerPerScopeIoEligibilityRecord;
  readonly operator_confirmation: true;
  readonly replay_namespace_path: string;
  readonly metadata_patch: ReplayNamespaceMetadataPatch;
  readonly now?: Date;
};
