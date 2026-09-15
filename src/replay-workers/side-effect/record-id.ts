/**
 * Deterministic replay worker side-effect record identity.
 * @see docs/product/replay-worker-side-effect-runtime-contract-v1.md
 */

import { createHash } from "node:crypto";

import type { ReplayWorkerSideEffectScope } from "./constants.js";
import type {
  ReplayWorkerSideEffectEligibilityState,
  ReplayWorkerSideEffectState,
} from "./types.js";

export function replayWorkerSideEffectEligibilityId(input: {
  readonly replay_worker_execution_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_side_effect_eligibility_state: ReplayWorkerSideEffectEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.replay_worker_execution_id.trim(),
    input.replay_execution_id.trim(),
    input.replay_worker_side_effect_eligibility_state.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function replayWorkerSideEffectId(input: {
  readonly replay_execution_id: string;
  readonly replay_worker_side_effect_state: ReplayWorkerSideEffectState;
  readonly replay_worker_side_effect_scope: ReplayWorkerSideEffectScope;
  readonly replay_worker_side_effect_version: string;
}): string {
  const payload = [
    input.replay_execution_id.trim(),
    input.replay_worker_side_effect_state.trim(),
    input.replay_worker_side_effect_scope.trim(),
    input.replay_worker_side_effect_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
