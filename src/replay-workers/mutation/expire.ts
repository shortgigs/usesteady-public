/**
 * Replay worker mutation eligibility expiry check (read-only).
 */

import type { ReplayWorkerMutationEligibilityRecord } from "./types.js";

export function isReplayWorkerMutationEligibilityExpired(
  record: ReplayWorkerMutationEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.replay_worker_mutation_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
