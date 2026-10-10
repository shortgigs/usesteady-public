/**
 * Deterministic replay namespace metadata per-scope I/O identity.
 * @see docs/product/replay-namespace-single-path-metadata-implementation-contract-v1.md
 */

import { createHash } from "node:crypto";

import type { ReplayNamespaceSinglePathMetadataScope } from "./constants.js";
import type {
  ReplayWorkerPerScopeIoEligibilityState,
  ReplayWorkerPerScopeIoState,
} from "./types.js";

export function replayWorkerPerScopeIoEligibilityId(input: {
  readonly replay_worker_mutation_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_per_scope_io_eligibility_state: ReplayWorkerPerScopeIoEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.replay_worker_mutation_id.trim(),
    input.replay_execution_id.trim(),
    input.replay_worker_per_scope_io_eligibility_state.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function replayWorkerPerScopeIoId(input: {
  readonly replay_execution_id: string;
  readonly replay_worker_per_scope_io_scope: ReplayNamespaceSinglePathMetadataScope;
  readonly replay_namespace_path: string;
  readonly replay_worker_per_scope_io_state: ReplayWorkerPerScopeIoState;
  readonly replay_worker_per_scope_io_version: string;
}): string {
  const payload = [
    input.replay_execution_id.trim(),
    input.replay_worker_per_scope_io_scope.trim(),
    input.replay_namespace_path.trim(),
    input.replay_worker_per_scope_io_state.trim(),
    input.replay_worker_per_scope_io_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
