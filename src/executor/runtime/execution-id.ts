/**
 * Deterministic execution identity — no timestamps (INV-ERUN-IMPL-7).
 */

import { createHash } from "node:crypto";

import type { ExecutionOutcome } from "./types.js";

export function executionId(input: {
  readonly capability_id: string;
  readonly executor_eligibility_record_id: string;
  readonly outcome: ExecutionOutcome;
  readonly reason: string;
  readonly blocking_cause: string;
}): string {
  const payload = [
    input.capability_id.trim(),
    input.executor_eligibility_record_id.trim(),
    input.outcome.trim(),
    input.reason.trim(),
    input.blocking_cause.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
