/**
 * Stable eligibility record identity — no timestamps (INV-CELIG-IMPL-8).
 */

import { createHash } from "node:crypto";

import type { CapabilityEligibilityState } from "./types.js";

export function eligibilityRecordId(input: {
  readonly capability_id: string;
  readonly version: string;
  readonly eligibility_state: CapabilityEligibilityState;
  readonly reason: string;
}): string {
  const payload = [
    input.capability_id,
    input.version,
    input.eligibility_state,
    input.reason,
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
