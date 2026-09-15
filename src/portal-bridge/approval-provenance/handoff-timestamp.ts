/**
 * Phase 3 Lane A (A2) — max UCP handoff `confirmedAt` for local-only approval runs.
 *
 * Mode B only: never supplies approver identity; optional timestamp from persisted
 * delivery handoff envelopes.
 */

import { getWorkflowAuditRecord } from "../../history/workflow-history.js";
import type { SessionChain } from "../../history/types.js";

function confirmedAtMsFromSession(session: SessionChain | null): number | null {
  if (!session) return null;

  const cursorAt = session.cursorHandoff?.payload.confirmedAt;
  if (typeof cursorAt === "number" && Number.isFinite(cursorAt)) {
    return cursorAt;
  }

  const claudeAt = session.claudeHandoff?.payload.confirmedAt;
  if (typeof claudeAt === "number" && Number.isFinite(claudeAt)) {
    return claudeAt;
  }

  return null;
}

/**
 * Pure helper: max handoff confirmedAt across audit task sessions, as ISO-8601.
 */
export function maxHandoffConfirmedAtFromSessions(
  sessions: readonly (SessionChain | null)[],
): string | null {
  let maxMs = -1;

  for (const session of sessions) {
    const ms = confirmedAtMsFromSession(session);
    if (ms !== null && ms > maxMs) maxMs = ms;
  }

  if (maxMs < 0) return null;
  return new Date(maxMs).toISOString();
}

/** Read audit record from store and return max handoff confirmedAt (Mode B). */
export function maxHandoffConfirmedAtIso(
  storeDir: string,
  workflowRunId: string,
): string | null {
  const record = getWorkflowAuditRecord(storeDir, workflowRunId);
  if (!record) return null;
  return maxHandoffConfirmedAtFromSessions(record.tasks.map((t) => t.session));
}
