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
import { getByType } from "../ucp/persistence/index.js";
import { buildSessionChain } from "./session-chain.js";
const WORKFLOW_RUN_TYPE = "ucp.workflow_run.v1";
/** Skip index drift: byType may list ids whose resolved envelope is another type. */
function isValidWorkflowRunEnvelope(env) {
    if (env.type !== WORKFLOW_RUN_TYPE)
        return false;
    const p = env.payload;
    if (p === null || typeof p !== "object")
        return false;
    if (typeof p.workflowRunId !== "string")
        return false;
    if (!Array.isArray(p.sessionRefs))
        return false;
    return true;
}
function summaryFromWorkflowRunEnvelope(env) {
    const p = env.payload;
    const inputs = p.taskInputs ?? [];
    const tasks = p.sessionRefs.map(ref => ({
        taskIndex: ref.taskIndex,
        outcome: ref.outcome,
        retryCount: ref.retryCount,
        input: inputs[ref.taskIndex] ?? null,
    }));
    return {
        envelopeId: env.id,
        workflowRunId: p.workflowRunId,
        workflowName: p.workflowName,
        ts: env.ts,
        finalOutcome: p.finalOutcome,
        taskCount: p.taskCount,
        acceptedCount: p.acceptedCount,
        skippedCount: p.skippedCount,
        tasks,
    };
}
// ─── Tier 1: history summaries ────────────────────────────────────────────────
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
export function getWorkflowHistories(storeDir) {
    let envelopes;
    try {
        envelopes = getByType(storeDir, "ucp.workflow_run.v1");
    }
    catch {
        return [];
    }
    const summaries = [];
    for (const env of envelopes) {
        if (!isValidWorkflowRunEnvelope(env))
            continue;
        summaries.push(summaryFromWorkflowRunEnvelope(env));
    }
    return summaries;
}
// ─── Tier 2: audit record ─────────────────────────────────────────────────────
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
export function getWorkflowAuditRecord(storeDir, workflowRunId) {
    let envelopes;
    try {
        envelopes = getByType(storeDir, "ucp.workflow_run.v1");
    }
    catch {
        return null;
    }
    const match = envelopes.find(env => {
        if (!isValidWorkflowRunEnvelope(env))
            return false;
        return env.payload.workflowRunId === workflowRunId;
    });
    if (match === undefined || !isValidWorkflowRunEnvelope(match))
        return null;
    const p = match.payload;
    const inputs = p.taskInputs ?? [];
    const tasks = p.sessionRefs.map(ref => {
        const session = ref.intentId
            ? buildSessionChain(storeDir, ref.intentId)
            : null;
        return {
            taskIndex: ref.taskIndex,
            input: inputs[ref.taskIndex] ?? null,
            outcome: ref.outcome,
            retryCount: ref.retryCount,
            session,
        };
    });
    return {
        envelopeId: match.id,
        workflowRunId: p.workflowRunId,
        workflowName: p.workflowName,
        ts: match.ts,
        finalOutcome: p.finalOutcome,
        taskCount: p.taskCount,
        acceptedCount: p.acceptedCount,
        skippedCount: p.skippedCount,
        tasks,
    };
}
//# sourceMappingURL=workflow-history.js.map