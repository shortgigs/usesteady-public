/**
 * Executor eligibility expiry check (read-only).
 */

import type { ExecutorEligibilityRecord } from "./types.js";

export function isExecutorEligibilityExpired(
  record: ExecutorEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.executor_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
