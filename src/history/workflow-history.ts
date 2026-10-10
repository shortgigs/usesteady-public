/**
 * Phase 10B: Workflow history / audit query functions.
 *
 * ── getWorkflowHistories ──────────────────────────────────────────────────────
 *
 *   Tier 1 — cheap, flat, envelope-only.
 *   Reads ucp.workflow_run.v1 envelopes and maps them to WorkflowHistorySummary.
 *   No per-task session-chain resolution.
 *   Never throws. Returns [] for empty or missing store.
 *
 * ── getWorkflowAuditRecord ────────────────────────────────────────────────────
 *
 *   Tier 2 — selected snapshot; unbound per-task chains withheld.
 *   Finds one execution instance (executionInstanceId, or legacy
 *   workflowRunId). Ambiguous spec-id queries return null (fail closed).
 *   Never throws. Returns null when not found or ambiguous.
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   Zero. Read-only. No imports from coordinator, sessions, or execution layer.
 *   Accepts storeDir only — no live WorkflowRun objects.
 */

import type { UCPEnvelope, WorkflowRunPayload } from "../ucp/types.js";
import {
  listWorkflowRunEnvelopes,
  resolveExecutionInstance,
  latestEnvelopeOf,
} from "./execution-instance-resolve.js";
import { executionInstanceKey } from "../workflow/execution-instance.js";
import type {
  WorkflowHistorySummary,
  WorkflowTaskHistoryEntry,
  WorkflowAuditRecord,
  WorkflowTaskAuditEntry,
  HistoryTaskOutcome,
} from "./types.js";

function summaryFromWorkflowRunEnvelope(
  env: UCPEnvelope<WorkflowRunPayload>,
): WorkflowHistorySummary {
  const p      = env.payload;
  const inputs = p.taskInputs ?? [];

  const tasks: WorkflowTaskHistoryEntry[] = p.sessionRefs.map(ref => ({
    taskIndex:  ref.taskIndex,
    outcome:    ref.outcome as HistoryTaskOutcome,
    retryCount: ref.retryCount,
    input:      inputs[ref.taskIndex] ?? null,
  }));

  return {
    envelopeId:    env.id,
    workflowRunId: p.workflowRunId,
    executionInstanceId: executionInstanceKey(p),
    workflowName:  p.workflowName,
    ts:            env.ts,
    finalOutcome:  p.finalOutcome,
    taskCount:     p.taskCount,
    acceptedCount: p.acceptedCount,
    skippedCount:  p.skippedCount,
    tasks,
  };
}

// ─── Tier 1: history summaries ────────────────────────────────────────────────

/**
 * Load all persisted workflow run summaries from the store.
 *
 * Returns one summary per execution instance, using its latest persisted snapshot.
 * Earlier snapshots remain in the append-only evidence store.
 *
 * task.input is populated from payload.taskInputs[taskIndex].
 * For V1.0 records (written before Phase 10B) that lack taskInputs,
 * input is null — the field is treated as [] when absent.
 *
 * Never throws.
 */
export function getWorkflowHistories(storeDir: string): WorkflowHistorySummary[] {
  const executions = new Map<string, UCPEnvelope<WorkflowRunPayload>[]>();
  for (const env of listWorkflowRunEnvelopes(storeDir)) {
    const key = executionInstanceKey(env.payload);
    executions.set(key, [...(executions.get(key) ?? []), env]);
  }
  return [...executions.values()].map(snapshots =>
    summaryFromWorkflowRunEnvelope(latestEnvelopeOf(snapshots)!),
  );
}

// ─── Tier 2: audit record ─────────────────────────────────────────────────────

/**
 * Load the full audit record for one workflow run.
 *
 * Scans ucp.workflow_run.v1 envelopes for a matching workflowRunId (D6: O(N) scan).
 * Root-only delivery chains are not execution-bound. Their per-execution
 * detail is unavailable; task outcomes come from the selected snapshot.
 *
 * Returns null when no matching run is found.
 * Never throws.
 */
export function getWorkflowAuditRecord(
  storeDir:      string,
  workflowRunId: string,
): WorkflowAuditRecord | null {
  const resolved = resolveExecutionInstance(storeDir, workflowRunId);
  if (resolved.kind !== "ok") return null;

  const match = resolved.envelope;
  const p      = match.payload;
  const inputs = p.taskInputs ?? [];

  const tasks: WorkflowTaskAuditEntry[] = p.sessionRefs.map(ref => {
    // Root-only IDs do not bind delivery evidence to an execution. Even a
    // single persisted execution may share its root with another active run,
    // or a late receipt from an earlier snapshot. Keep snapshot outcomes,
    // but do not attribute unbound session detail to this execution.
    const session = null;

    return {
      taskIndex:  ref.taskIndex,
      input:      inputs[ref.taskIndex] ?? null,
      outcome:    ref.outcome as HistoryTaskOutcome,
      retryCount: ref.retryCount,
      session,
    };
  });

  return {
    envelopeId:    match.id,
    workflowRunId: p.workflowRunId,
    executionInstanceId: executionInstanceKey(p),
    workflowName:  p.workflowName,
    ts:            match.ts,
    finalOutcome:  p.finalOutcome,
    taskCount:     p.taskCount,
    acceptedCount: p.acceptedCount,
    skippedCount:  p.skippedCount,
    tasks,
  };
}
