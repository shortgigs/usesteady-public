/**
 * Deterministic replay worker eligibility record identity (INV-RWORK-ELIG-IMPL-7).
 */

import { createHash } from "node:crypto";

import type { ReplayWorkerEligibilityState } from "./types.js";

export function replayWorkerEligibilityId(input: {
  readonly replay_execution_id: string;
  readonly replay_worker_eligibility_state: ReplayWorkerEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.replay_execution_id.trim(),
    input.replay_worker_eligibility_state.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
