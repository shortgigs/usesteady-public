/**
 * Deterministic replay worker mutation record identity.
 * @see docs/product/replay-worker-bounded-mutation-runtime-contract-v1.md
 */

import { createHash } from "node:crypto";

import type { ReplayWorkerMutationScope } from "./constants.js";
import type {
  ReplayWorkerMutationEligibilityState,
  ReplayWorkerMutationState,
} from "./types.js";

export function replayWorkerMutationEligibilityId(input: {
  readonly replay_worker_side_effect_id: string;
  readonly replay_worker_execution_id: string;
  readonly replay_execution_id: string;
  readonly replay_worker_mutation_eligibility_state: ReplayWorkerMutationEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.replay_worker_side_effect_id.trim(),
    input.replay_worker_execution_id.trim(),
    input.replay_execution_id.trim(),
    input.replay_worker_mutation_eligibility_state.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function replayWorkerMutationId(input: {
  readonly replay_execution_id: string;
  readonly replay_worker_mutation_state: ReplayWorkerMutationState;
  readonly replay_worker_mutation_scope: ReplayWorkerMutationScope;
  readonly replay_worker_mutation_version: string;
}): string {
  const payload = [
    input.replay_execution_id.trim(),
    input.replay_worker_mutation_state.trim(),
    input.replay_worker_mutation_scope.trim(),
    input.replay_worker_mutation_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
