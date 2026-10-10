/**
 * Replay worker execution eligibility expiry check (read-only).
 */

import type { ReplayWorkerExecutionEligibilityRecord } from "./types.js";

export function isReplayWorkerExecutionEligibilityExpired(
  record: ReplayWorkerExecutionEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.replay_worker_execution_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
