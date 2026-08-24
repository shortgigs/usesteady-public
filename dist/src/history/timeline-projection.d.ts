/**
 * Timeline projection — pure read model over WorkflowAuditRecord.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * Authority: zero. No store I/O. No coordinator / execution imports.
 */
import type { HistoryTaskOutcome, WorkflowAuditRecord } from "./types.js";
export type TimelineDisplayState = "completed" | "skipped" | "auto-skipped" | "stopped" | "rejected" | "not_started" | "planning_reviewed";
export type TimelineTaskRow = {
    readonly taskIndex: number;
    readonly input: string | null;
    readonly displayState: TimelineDisplayState;
    /** Authoritative persisted outcome; null when the task never started. */
    readonly outcome: HistoryTaskOutcome | null;
    readonly startedTs: number | null;
    readonly endedTs: number | null;
    readonly retryCount: number;
};
export type TimelineRunView = {
    readonly kind: "run";
    readonly workflowRunId: string;
    readonly workflowName: string;
    readonly finalOutcome: "completed" | "stopped";
    readonly taskCount: number;
    readonly runEndedTs: number;
    readonly tasks: readonly TimelineTaskRow[];
};
export type TimelineEmptyView = {
    readonly kind: "empty";
};
/** K7-I1 / K7-I2: no partial rows; no unknown-vs-interrupted differentiation. */
export type TimelineIncompleteView = {
    readonly kind: "incomplete";
    readonly runId: string;
};
export type TimelineView = TimelineEmptyView | TimelineIncompleteView | TimelineRunView;
export declare function outcomeToDisplayState(outcome: HistoryTaskOutcome | null): TimelineDisplayState;
/**
 * Project one terminal workflow run into a chronological timeline view.
 * `taskInputs` must align with payload.taskInputs (index → label).
 */
export declare function projectTimelineView(audit: WorkflowAuditRecord, taskInputs: readonly (string | null)[]): TimelineRunView;
/** Highest 1-based task position with any non-not_started row (for stopped header). */
export declare function stoppedAtTaskOneBased(tasks: readonly TimelineTaskRow[]): number;
//# sourceMappingURL=timeline-projection.d.ts.map