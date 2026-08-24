/**
 * Timeline projection — pure read model over WorkflowAuditRecord.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * Authority: zero. No store I/O. No coordinator / execution imports.
 */
export function outcomeToDisplayState(outcome) {
    if (outcome === null || outcome === "pending")
        return "not_started";
    switch (outcome) {
        case "accepted":
            return "completed";
        case "skipped":
            return "skipped";
        case "skipped_by_intake":
            return "auto-skipped";
        case "stopped":
            return "stopped";
        case "rejected":
            return "rejected";
        case "planning_reviewed":
            return "planning_reviewed";
    }
}
function sessionStartedTs(session) {
    const times = [];
    if (session.intent !== null)
        times.push(session.intent.ts);
    if (session.cursorHandoff !== null)
        times.push(session.cursorHandoff.ts);
    if (session.claudeHandoff !== null)
        times.push(session.claudeHandoff.ts);
    return times.length > 0 ? Math.min(...times) : null;
}
function sessionEndedTs(session) {
    const end = session.cursorReceipt ??
        session.claudeReceipt ??
        session.cursorRefused ??
        session.claudeRefused;
    return end !== null ? end.ts : null;
}
/**
 * Project one terminal workflow run into a chronological timeline view.
 * `taskInputs` must align with payload.taskInputs (index → label).
 */
export function projectTimelineView(audit, taskInputs) {
    const byIndex = new Map(audit.tasks.map((t) => [t.taskIndex, t]));
    const tasks = [];
    for (let i = 0; i < audit.taskCount; i += 1) {
        const entry = byIndex.get(i);
        if (entry === undefined) {
            tasks.push({
                taskIndex: i,
                input: taskInputs[i] ?? null,
                displayState: "not_started",
                outcome: null,
                startedTs: null,
                endedTs: null,
                retryCount: 0,
            });
            continue;
        }
        const session = entry.session;
        const startedTs = session !== null ? sessionStartedTs(session) : null;
        const endedTs = session !== null ? sessionEndedTs(session) : null;
        tasks.push({
            taskIndex: i,
            input: entry.input ?? taskInputs[i] ?? null,
            displayState: outcomeToDisplayState(entry.outcome),
            outcome: entry.outcome,
            startedTs,
            endedTs,
            retryCount: entry.retryCount,
        });
    }
    return {
        kind: "run",
        workflowRunId: audit.workflowRunId,
        workflowName: audit.workflowName,
        finalOutcome: audit.finalOutcome,
        taskCount: audit.taskCount,
        runEndedTs: audit.ts,
        tasks,
    };
}
/** Highest 1-based task position with any non-not_started row (for stopped header). */
export function stoppedAtTaskOneBased(tasks) {
    let max = 0;
    for (const row of tasks) {
        if (row.displayState !== "not_started") {
            max = Math.max(max, row.taskIndex + 1);
        }
    }
    return max;
}
//# sourceMappingURL=timeline-projection.js.map