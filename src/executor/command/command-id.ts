/**
 * Content-addressed command execution record id (INV-RCMD-5).
 */

import { createHash } from "node:crypto";

import type { CommandExecutionDecision } from "./types.js";

export function commandExecutionRecordId(input: {
  readonly command_idempotency_key: string;
  readonly request_id: string;
  readonly handler_result_id: string;
  readonly decision: CommandExecutionDecision;
  readonly actor_id: string;
  readonly decided_at: string;
}): string {
  const preimage = [
    input.command_idempotency_key.trim(),
    input.request_id.trim(),
    input.handler_result_id.trim(),
    input.decision,
    input.actor_id.trim(),
    input.decided_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
