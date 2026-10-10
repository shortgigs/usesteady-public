/**
 * Content-addressed state mutation record id (mutation idempotency).
 */

import { createHash } from "node:crypto";

import type { StateMutationDecision } from "./types.js";

export function stateMutationRecordId(input: {
  readonly mutation_idempotency_key: string;
  readonly request_id: string;
  readonly command_record_id: string;
  readonly decision: StateMutationDecision;
  readonly actor_id: string;
  readonly applied_at: string;
}): string {
  const preimage = [
    input.mutation_idempotency_key.trim(),
    input.request_id.trim(),
    input.command_record_id.trim(),
    input.decision,
    input.actor_id.trim(),
    input.applied_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
