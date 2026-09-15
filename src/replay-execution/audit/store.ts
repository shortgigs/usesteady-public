/**
 * Append-only in-memory PREX audit store (INV-PREX-AUDIT-1, INV-PREX-AUDIT-4).
 */

import type { ReplayExecutionAuditEntry } from "./types.js";

const entriesByJobId = new Map<string, ReplayExecutionAuditEntry[]>();
const idIndex = new Map<string, ReplayExecutionAuditEntry>();

function idempotencyKey(job_id: string, replay_execution_id: string): string {
  return `${job_id.trim()}\0${replay_execution_id.trim()}`;
}

function sortEntries(
  entries: readonly ReplayExecutionAuditEntry[],
): readonly ReplayExecutionAuditEntry[] {
  return [...entries].sort((a, b) => {
    const at = a.recorded_at.localeCompare(b.recorded_at);
    if (at !== 0) return at;
    return a.replay_execution_id.localeCompare(b.replay_execution_id);
  });
}

export function appendReplayExecutionAuditEntry(
  entry: ReplayExecutionAuditEntry,
): { readonly entry: ReplayExecutionAuditEntry; readonly idempotent: boolean } {
  const job_id = entry.job_id.trim();
  const replay_execution_id = entry.replay_execution_id.trim();
  const key = idempotencyKey(job_id, replay_execution_id);

  const existing = idIndex.get(key);
  if (existing !== undefined) {
    return { entry: existing, idempotent: true };
  }

  const list = entriesByJobId.get(job_id) ?? [];
  const next = [...list, entry];
  entriesByJobId.set(job_id, next);
  idIndex.set(key, entry);

  return { entry, idempotent: false };
}

export function listReplayExecutionAuditEntries(
  job_id: string,
): readonly ReplayExecutionAuditEntry[] {
  const list = entriesByJobId.get(job_id.trim());
  if (list === undefined) return [];
  return sortEntries(list);
}

export function resetReplayExecutionAuditStoreForTests(): void {
  entriesByJobId.clear();
  idIndex.clear();
}
