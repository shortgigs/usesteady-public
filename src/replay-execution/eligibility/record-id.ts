/**
 * Deterministic replay execution eligibility record identity (INV-REXELIG-IMPL-7).
 */

import { createHash } from "node:crypto";

import type { ReplayExecutionEligibilityState } from "./types.js";

export function replayExecutionEligibilityRecordId(input: {
  readonly replay_sandbox_id: string;
  readonly replay_execution_eligibility_state: ReplayExecutionEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.replay_sandbox_id.trim(),
    input.replay_execution_eligibility_state.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
