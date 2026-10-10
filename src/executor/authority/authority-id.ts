/**
 * Content-addressed execution authority record id (INV-REXEC-5).
 *
 * Preimage (positional array, JSON.stringify):
 *   [ request_id, job_id, idempotency_key, decision, actor_id, decided_at ]
 */

import { createHash } from "node:crypto";

import type { ExecutionAuthorizationDecision } from "./types.js";

export function executionAuthorityRecordId(input: {
  readonly request_id: string;
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly decision: ExecutionAuthorizationDecision;
  readonly actor_id: string;
  readonly decided_at: string;
}): string {
  const preimage = [
    input.request_id.trim(),
    input.job_id.trim(),
    input.idempotency_key.trim(),
    input.decision,
    input.actor_id.trim(),
    input.decided_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
