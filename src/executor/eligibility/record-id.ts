/**
 * Stable executor eligibility record identity — no timestamps (INV-EEXEC-IMPL-7).
 */

import { createHash } from "node:crypto";

import type { ExecutorEligibilityState } from "./types.js";

export function executorEligibilityRecordId(input: {
  readonly capability_id: string;
  readonly executor_eligibility_state: ExecutorEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.capability_id,
    input.executor_eligibility_state,
    input.reason,
    input.blocking_cause,
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
