/**
 * Replay worker eligibility expiry check (read-only).
 */

import type { ReplayWorkerEligibilityRecord } from "./types.js";

export function isReplayWorkerEligibilityExpired(
  record: ReplayWorkerEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.replay_worker_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
