/**
 * Deterministic replay worker execution record identity (INV-RWORK-EXEC-IMPL-13).
 */

import { createHash } from "node:crypto";

import type {
  ReplayWorkerExecutionEligibilityState,
  ReplayWorkerExecutionState,
} from "./types.js";

export function replayWorkerExecutionEligibilityId(input: {
  readonly replay_worker_dispatch_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_execution_eligibility_state: ReplayWorkerExecutionEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.replay_worker_dispatch_id.trim(),
    input.replay_execution_id.trim(),
    input.replay_worker_execution_eligibility_state.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function replayWorkerExecutionId(input: {
  readonly replay_execution_id: string;
  readonly replay_worker_execution_state: ReplayWorkerExecutionState;
  readonly replay_worker_execution_version: string;
}): string {
  const payload = [
    input.replay_execution_id.trim(),
    input.replay_worker_execution_state.trim(),
    input.replay_worker_execution_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
