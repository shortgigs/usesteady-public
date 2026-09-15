/**
 * Append-only replay-namespace audit line store (no overwrite/delete/truncate).
 * @see docs/product/replay-namespace-audit-append-only-implementation-contract-v1.md
 */

import { replayNamespaceAuditLineId } from "./record-id.js";
import type { ReplayNamespaceAuditLineEntry, ReplayNamespaceAuditLinePayload } from "./types.js";

const linesByJobId = new Map<string, ReplayNamespaceAuditLineEntry[]>();
const lineIndex = new Map<string, ReplayNamespaceAuditLineEntry>();

function lineKey(job_id: string, audit_line_id: string): string {
  return `${job_id.trim()}\0${audit_line_id.trim()}`;
}

function sortLines(
  lines: readonly ReplayNamespaceAuditLineEntry[],
): readonly ReplayNamespaceAuditLineEntry[] {
  return [...lines].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

/**
 * Append one audit line — never overwrites, deletes, or truncates existing lines.
 */
export function appendReplayNamespaceAuditLineToStore(
  payload: ReplayNamespaceAuditLinePayload,
  replay_worker_per_scope_io_id: string,
): { readonly entry: ReplayNamespaceAuditLineEntry; readonly append_idempotent: boolean } {
  const job_id = payload.job_id.trim();
  const audit_line_id = replayNamespaceAuditLineId({
    replay_worker_per_scope_io_id,
    replay_worker_mutation_id: payload.replay_worker_mutation_id,
    message: payload.message,
  });
  const key = lineKey(job_id, audit_line_id);

  const existing = lineIndex.get(key);
  if (existing !== undefined) {
    return { entry: existing, append_idempotent: true };
  }

  const entry: ReplayNamespaceAuditLineEntry = {
    ...payload,
    audit_line_id,
  };

  const list = linesByJobId.get(job_id) ?? [];
  linesByJobId.set(job_id, [...list, entry]);
  lineIndex.set(key, entry);

  return { entry, append_idempotent: false };
}

export function listReplayNamespaceAuditLines(
  job_id: string,
): readonly ReplayNamespaceAuditLineEntry[] {
  const list = linesByJobId.get(job_id.trim());
  if (list === undefined) return [];
  return sortLines(list);
}

export function resetReplayNamespaceAuditStoreForTests(): void {
  linesByJobId.clear();
  lineIndex.clear();
}
