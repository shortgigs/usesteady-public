/**
 * Per-scope I/O eligibility expiry check (read-only).
 */

import type { ReplayWorkerPerScopeIoEligibilityRecord } from "./types.js";

export function isReplayWorkerPerScopeIoEligibilityExpired(
  record: ReplayWorkerPerScopeIoEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.replay_worker_per_scope_io_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
