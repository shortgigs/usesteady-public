/**
 * Deterministic replay execution identity (INV-PREX-IMPL-11).
 */

import { createHash } from "node:crypto";

import type { ReplayExecutionState } from "./types.js";

export function replayExecutionId(input: {
  readonly replay_sandbox_id: string;
  readonly replay_execution_state: ReplayExecutionState;
  readonly replay_execution_version: string;
}): string {
  const payload = [
    input.replay_sandbox_id.trim(),
    input.replay_execution_state.trim(),
    input.replay_execution_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
