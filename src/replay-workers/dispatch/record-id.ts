/**
 * Deterministic replay worker dispatch record identity (INV-RWORK-DISPATCH-IMPL-13).
 */

import { createHash } from "node:crypto";

import type { ReplayWorkerDispatchState } from "./types.js";

export function replayWorkerDispatchId(input: {
  readonly replay_execution_id: string;
  readonly replay_worker_dispatch_state: ReplayWorkerDispatchState;
  readonly replay_worker_dispatch_version: string;
}): string {
  const payload = [
    input.replay_execution_id.trim(),
    input.replay_worker_dispatch_state.trim(),
    input.replay_worker_dispatch_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
