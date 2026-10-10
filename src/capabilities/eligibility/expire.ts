/**
 * Capability eligibility expiry check (read-only).
 */

import type { CapabilityEligibilityRecord } from "./types.js";

export function isCapabilityEligibilityExpired(
  record: CapabilityEligibilityRecord,
  now: Date = new Date(),
): boolean {
  const expires = Date.parse(record.capability_eligibility_expires_at);
  if (Number.isNaN(expires)) return true;
  return now.getTime() > expires;
}
