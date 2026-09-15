/**
 * Replay worker side-effect eligibility expiry check (read-only).
 */

import type { ReplayWorkerSideEffectEligibilityRecord } from "./types.js";

export function isReplayWorkerSideEffectEligibilityExpired(
  record: ReplayWorkerSideEffectEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.replay_worker_side_effect_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
