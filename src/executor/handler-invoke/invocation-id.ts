/**
 * Content-addressed handler invocation + result record ids (INV-RHAND-5).
 */

import { createHash } from "node:crypto";

import type { HandlerExecutionOutcome, HandlerInvocationDecision } from "./types.js";

export function handlerInvocationRecordId(input: {
  readonly invocation_idempotency_key: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly decision: HandlerInvocationDecision;
  readonly invoked_at: string;
}): string {
  const preimage = [
    input.invocation_idempotency_key.trim(),
    input.authority_record_id.trim(),
    input.job_id.trim(),
    input.decision,
    input.invoked_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}

export function handlerExecutionResultRecordId(input: {
  readonly invocation_record_id: string;
  readonly outcome: HandlerExecutionOutcome;
  readonly recorded_at: string;
}): string {
  const preimage = [
    input.invocation_record_id.trim(),
    input.outcome,
    input.recorded_at.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
