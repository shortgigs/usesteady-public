/**
 * Append-only replay-namespace trace line store (no rewrite/truncate/delete/replace).
 * @see docs/product/replay-namespace-trace-line-append-implementation-contract-v1.md
 */

import { replayNamespaceTraceLineId } from "./record-id.js";
import type { ReplayNamespaceTraceLineEntry, ReplayNamespaceTraceLinePayload } from "./types.js";

const linesByTarget = new Map<string, ReplayNamespaceTraceLineEntry[]>();
const lineIndex = new Map<string, ReplayNamespaceTraceLineEntry>();

function lineKey(replay_trace_target: string, trace_line_id: string): string {
  return `${replay_trace_target.trim()}\0${trace_line_id.trim()}`;
}

function sortLines(
  lines: readonly ReplayNamespaceTraceLineEntry[],
): readonly ReplayNamespaceTraceLineEntry[] {
  return [...lines].sort((a, b) => {
    const atA = a.recorded_at ?? "";
    const atB = b.recorded_at ?? "";
    return atA.localeCompare(atB);
  });
}

export type AppendTraceLineStoreInput = ReplayNamespaceTraceLinePayload & {
  readonly job_id: string;
  readonly replay_worker_mutation_id: string;
  readonly replay_execution_id: string;
  readonly replay_trace_target: string;
};

/**
 * Append one trace line to one target — never rewrites, truncates, deletes, or replaces.
 */
export function appendReplayNamespaceTraceLineToStore(
  payload: AppendTraceLineStoreInput,
  replay_worker_per_scope_io_id: string,
): { readonly entry: ReplayNamespaceTraceLineEntry; readonly append_idempotent: boolean } {
  const target = payload.replay_trace_target.trim();
  const trace_line_id = replayNamespaceTraceLineId({
    replay_worker_per_scope_io_id,
    replay_trace_target: target,
    replay_worker_mutation_id: payload.replay_worker_mutation_id,
    message: payload.message,
  });
  const key = lineKey(target, trace_line_id);

  const existing = lineIndex.get(key);
  if (existing !== undefined) {
    return { entry: existing, append_idempotent: true };
  }

  const entry: ReplayNamespaceTraceLineEntry = {
    ...payload,
    replay_trace_target: target,
    trace_line_id,
    recorded_at: payload.recorded_at ?? new Date().toISOString(),
  };

  const list = linesByTarget.get(target) ?? [];
  linesByTarget.set(target, [...list, entry]);
  lineIndex.set(key, entry);

  return { entry, append_idempotent: false };
}

export function listReplayNamespaceTraceLines(
  replay_trace_target: string,
): readonly ReplayNamespaceTraceLineEntry[] {
  const list = linesByTarget.get(replay_trace_target.trim());
  if (list === undefined) return [];
  return sortLines(list);
}

export function resetReplayNamespaceTraceStoreForTests(): void {
  linesByTarget.clear();
  lineIndex.clear();
}
