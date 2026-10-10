/**
 * Replay namespace audit append-only per-scope I/O (public exports).
 * @see docs/product/replay-namespace-audit-append-only-implementation-contract-v1.md
 */

export {
  REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE,
  REPLAY_NAMESPACE_AUDIT_LINE_MESSAGE_MAX,
  REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS,
  REPLAY_WORKER_PER_SCOPE_IO_VERSION,
  isReplayNamespaceAuditAppendOnlyScope,
} from "./constants.js";

export type { ReplayNamespaceAuditAppendOnlyScope } from "./constants.js";

export {
  evaluateReplayWorkerPerScopeIoEligibility,
} from "./evaluate.js";

export {
  appendReplayNamespaceAuditLine,
  replayWorkerPerScopeIoOutcomeFingerprint,
} from "./append.js";

export { isReplayWorkerPerScopeIoEligibilityExpired } from "./expire.js";

export {
  replayWorkerPerScopeIoEligibilityId,
  replayWorkerPerScopeIoId,
  replayNamespaceAuditLineId,
} from "./record-id.js";

export {
  appendReplayNamespaceAuditLineToStore,
  listReplayNamespaceAuditLines,
  resetReplayNamespaceAuditStoreForTests,
} from "./store.js";

export type {
  AppendReplayNamespaceAuditLineInput,
  EvaluateReplayWorkerPerScopeIoEligibilityInput,
  ReplayNamespaceAuditLineEntry,
  ReplayNamespaceAuditLinePayload,
  ReplayWorkerPerScopeIoEligibilityRecord,
  ReplayWorkerPerScopeIoEligibilityState,
  ReplayWorkerPerScopeIoLineageEntry,
  ReplayWorkerPerScopeIoLineageKind,
  ReplayWorkerPerScopeIoRecord,
  ReplayWorkerPerScopeIoScope,
  ReplayWorkerPerScopeIoState,
} from "./types.js";
