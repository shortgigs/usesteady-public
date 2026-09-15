/**
 * Deterministic worker claim / result fingerprints (audit only).
 */

import { createHash } from "node:crypto";

import type { WorkerResultOutcome } from "./types.js";

export function workerClaimId(input: {
  readonly job_id: string;
  readonly attempt: number;
  readonly claimed_at: string;
}): string {
  const preimage = [
    input.job_id.trim(),
    String(input.attempt),
    input.claimed_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}

export function workerResultId(input: {
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly outcome: WorkerResultOutcome;
  readonly processed_at: string;
}): string {
  const preimage = [
    input.job_id.trim(),
    input.idempotency_key.trim(),
    input.outcome,
    input.processed_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
