/**
 * Replay namespace single-path metadata per-scope I/O (public exports).
 * @see docs/product/replay-namespace-single-path-metadata-implementation-contract-v1.md
 */

export {
  REPLAY_NAMESPACE_PATH_PREFIX,
  REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE,
  REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS,
  REPLAY_WORKER_PER_SCOPE_IO_VERSION,
  ALLOWED_METADATA_PATCH_KEYS,
  isReplayNamespaceSinglePathMetadataScope,
} from "./constants.js";

export type { ReplayNamespaceSinglePathMetadataScope } from "./constants.js";

export {
  evaluateReplayWorkerPerScopeIoEligibility,
} from "./evaluate.js";

export {
  updateReplayNamespaceSinglePathMetadata,
  replayWorkerPerScopeIoOutcomeFingerprint,
} from "./update.js";

export { isReplayWorkerPerScopeIoEligibilityExpired } from "./expire.js";

export {
  replayWorkerPerScopeIoEligibilityId,
  replayWorkerPerScopeIoId,
} from "./record-id.js";

export {
  setReplayNamespacePathMetadata,
  getReplayNamespacePathMetadata,
  resetReplayNamespaceMetadataStoreForTests,
} from "./store.js";

export { validateReplayNamespacePath } from "./path.js";
export { validateMetadataPatch } from "./patch.js";

export type {
  EvaluateReplayWorkerPerScopeIoEligibilityInput,
  ReplayNamespaceMetadataPatch,
  ReplayNamespacePathMetadataRecord,
  ReplayWorkerPerScopeIoEligibilityRecord,
  ReplayWorkerPerScopeIoEligibilityState,
  ReplayWorkerPerScopeIoLineageEntry,
  ReplayWorkerPerScopeIoLineageKind,
  ReplayWorkerPerScopeIoRecord,
  ReplayWorkerPerScopeIoScope,
  ReplayWorkerPerScopeIoState,
  UpdateReplayNamespaceSinglePathMetadataInput,
} from "./types.js";
