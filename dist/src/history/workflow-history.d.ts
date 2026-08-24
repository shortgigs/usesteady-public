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
 *   Tier 2 — deep, per-task chain resolution.
 *   Finds one workflow run by workflowRunId then resolves every task's session
 *   chain via buildSessionChain.
 *   Never throws. Returns null when workflowRunId is not found.
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   Zero. Read-only. No imports from coordinator, sessions, or execution layer.
 *   Accepts storeDir only — no live WorkflowRun objects.
 */
import type { WorkflowHistorySummary, WorkflowAuditRecord } from "./types.js";
/**
 * Load all persisted workflow run summaries from the store.
 *
 * Returns a WorkflowHistorySummary for every ucp.workflow_run.v1 envelope,
 * in log order (chronological — first written is first returned).
 *
 * task.input is populated from payload.taskInputs[taskIndex].
 * For V1.0 records (written before Phase 10B) that lack taskInputs,
 * input is null — the field is treated as [] when absent.
 *
 * Never throws.
 */
export declare function getWorkflowHistories(storeDir: string): WorkflowHistorySummary[];
/**
 * Load the full audit record for one workflow run.
 *
 * Scans ucp.workflow_run.v1 envelopes for a matching workflowRunId (D6: O(N) scan).
 * For each task that has an intentId, calls buildSessionChain to resolve the
 * full delivery envelope chain.
 *
 * Returns null when no matching run is found.
 * Never throws.
 */
export declare function getWorkflowAuditRecord(storeDir: string, workflowRunId: string): WorkflowAuditRecord | null;
//# sourceMappingURL=workflow-history.d.ts.map