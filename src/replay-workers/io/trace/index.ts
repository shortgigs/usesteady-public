/**
 * Replay namespace trace-line append per-scope I/O (public exports).
 * @see docs/product/replay-namespace-trace-line-append-implementation-contract-v1.md
 */

export {
  REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE,
  REPLAY_TRACE_TARGET_PREFIX,
  REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS,
  REPLAY_WORKER_PER_SCOPE_IO_VERSION,
  REPLAY_NAMESPACE_TRACE_LINE_MESSAGE_MAX,
  isReplayNamespaceTraceLineAppendScope,
} from "./constants.js";

export type { ReplayNamespaceTraceLineAppendScope } from "./constants.js";

export {
  evaluateReplayWorkerPerScopeIoEligibility,
} from "./evaluate.js";

export {
  appendReplayNamespaceTraceLine,
  replayWorkerPerScopeIoOutcomeFingerprint,
} from "./append.js";

export { isReplayWorkerPerScopeIoEligibilityExpired } from "./expire.js";

export {
  replayWorkerPerScopeIoEligibilityId,
  replayWorkerPerScopeIoId,
} from "./record-id.js";

export {
  appendReplayNamespaceTraceLineToStore,
  listReplayNamespaceTraceLines,
  resetReplayNamespaceTraceStoreForTests,
} from "./store.js";

export { validateReplayTraceTarget } from "./target.js";
export { validateTraceLine } from "./line.js";

export type {
  AppendReplayNamespaceTraceLineInput,
  AppendReplayNamespaceTraceLineResult,
  EvaluateReplayWorkerPerScopeIoEligibilityInput,
  ReplayNamespaceTraceLineEntry,
  ReplayNamespaceTraceLinePayload,
  ReplayWorkerPerScopeIoEligibilityRecord,
  ReplayWorkerPerScopeIoEligibilityState,
  ReplayWorkerPerScopeIoLineageEntry,
  ReplayWorkerPerScopeIoLineageKind,
  ReplayWorkerPerScopeIoRecord,
  ReplayWorkerPerScopeIoScope,
  ReplayWorkerPerScopeIoState,
} from "./types.js";
