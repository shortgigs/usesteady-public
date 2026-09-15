/**
 * Replay execution eligibility expiry check (read-only).
 */

import type { ReplayExecutionEligibilityRecord } from "./types.js";

export function isReplayExecutionEligibilityExpired(
  record: ReplayExecutionEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.replay_execution_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
