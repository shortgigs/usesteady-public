/**
 * Replay namespace trace-line append I/O defaults.
 * @see docs/product/replay-namespace-trace-line-append-implementation-contract-v1.md
 */

export const REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE =
  "replay_namespace_trace_line_append" as const;

export type ReplayNamespaceTraceLineAppendScope =
  typeof REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE;

export const REPLAY_WORKER_PER_SCOPE_IO_VERSION = "v1";

export const REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS = 300_000;

/** Trace artifact targets must live under this replay trace namespace prefix. */
export const REPLAY_TRACE_TARGET_PREFIX = "replay/trace/";

export const REPLAY_NAMESPACE_TRACE_LINE_MESSAGE_MAX = 4_096;

export function isReplayNamespaceTraceLineAppendScope(
  value: string,
): value is ReplayNamespaceTraceLineAppendScope {
  return value === REPLAY_NAMESPACE_TRACE_LINE_APPEND_SCOPE;
}
