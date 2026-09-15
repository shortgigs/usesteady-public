/**
 * src/workflow/execution-instance.ts
 *
 * P-MED / F-02 — Execution instance identity.
 *
 * Two identities, two meanings:
 *   - Spec / workflow identity: `deriveWorkflowRunId(spec)` — stable for the
 *     same specification. Used by SDK approval binding. Same spec ⇒ same id.
 *   - Execution-instance identity: minted once per `createWorkflowRun`.
 *     Immutable for that execution. Same spec ⇒ new id every execution.
 *
 * This module must not import `src/kernel/*`.
 *
 * Explicit non-claims (do not collapse into this slice):
 *   - P-F01 reopen (POSIX/file-symlink) — closed; regression tests only
 *   - Audit durability / tamper evidence / actor attribution
 *   - Read-only labeling, create-content correctness
 *   - Windows path cases, roadmap cleanup, public claims
 *   - `.72` modification or a named successor release
 */

import { randomBytes } from "node:crypto";

/** 16 hex chars — same display width as the spec-derived workflowRunId. */
export function createExecutionInstanceId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Operator-facing and store-facing key for one execution.
 * Legacy envelopes without `executionInstanceId` keep using `workflowRunId`.
 */
export function executionInstanceKey(payload: {
  readonly workflowRunId: string;
  readonly executionInstanceId?: string;
}): string {
  return payload.executionInstanceId ?? payload.workflowRunId;
}

/**
 * Well-order for `--last` and "latest record of this instance".
 *
 * Primary: `executionOrdinal` (monotonic integer assigned at persist).
 * Missing ordinal (legacy) sorts as 0 — before every ordinal-bearing record.
 * Ties: envelope `ts`, then envelope `id` (content-addressed, unique).
 *
 * This is not filename order, not `getByType` map iteration, and not
 * timestamp-alone. Timestamps are a documented legacy tie-break only.
 */
export type ExecutionOrderKey = {
  readonly executionOrdinal: number;
  readonly ts: number;
  readonly envelopeId: string;
};

export function executionOrderKeyOf(input: {
  readonly executionOrdinal?: number;
  readonly ts: number;
  readonly envelopeId: string;
}): ExecutionOrderKey {
  return {
    executionOrdinal: typeof input.executionOrdinal === "number" && Number.isFinite(input.executionOrdinal)
      ? input.executionOrdinal
      : 0,
    ts: input.ts,
    envelopeId: input.envelopeId,
  };
}

export function compareExecutionOrder(a: ExecutionOrderKey, b: ExecutionOrderKey): number {
  if (a.executionOrdinal !== b.executionOrdinal) return a.executionOrdinal - b.executionOrdinal;
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.envelopeId < b.envelopeId) return -1;
  if (a.envelopeId > b.envelopeId) return 1;
  return 0;
}
