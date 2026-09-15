/**
 * Phase 11A-Web: History + audit view model adapters.
 *
 * Translates WorkflowHistorySummary → list item props.
 * Translates WorkflowAuditRecord   → detail view props.
 *
 * Pure — no React, no network. All mapping is deterministic.
 *
 * UI-W4: History views read persisted records only, never live coordinator state.
 */

import type {
  WorkflowHistorySummary,
  WorkflowAuditRecord,
  WorkflowTaskAuditEntry,
  HistoryTaskOutcome,
} from "../api/types.js";
import { historyOutcomeBadge } from "../helpers/task-status.js";

// ─── History list item ────────────────────────────────────────────────────────

export type HistoryListItem = {
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly name:          string;
  readonly date:          string;   // human-formatted
  readonly ts:            string;   // raw timestamp (for relative-time display)
  readonly finalOutcome:  "completed" | "stopped";
  readonly taskCount:     number;
  readonly acceptedCount: number;
  readonly skippedCount:  number;
  readonly successRate:   number;   // 0–1
};

export function workflowHistoryToListItem(
  summary: WorkflowHistorySummary,
): HistoryListItem {
  return {
    workflowRunId: summary.workflowRunId,
    executionInstanceId: summary.executionInstanceId,
    name:          summary.workflowName,
    date:          new Date(summary.ts).toLocaleString(),
    ts:            summary.ts,
    finalOutcome:  summary.finalOutcome,
    taskCount:     summary.taskCount,
    acceptedCount: summary.acceptedCount,
    skippedCount:  summary.skippedCount,
    successRate:   summary.taskCount > 0
      ? summary.acceptedCount / summary.taskCount
      : 0,
  };
}

// ─── Audit detail ─────────────────────────────────────────────────────────────

export type AuditTaskItem = {
  readonly taskIndex:  number;
  readonly input:      string;
  readonly outcome:    HistoryTaskOutcome;
  readonly outcomeBadge: { label: string; variant: string };
  readonly retryCount: number;
  readonly runtime:    "cursor" | "claude" | "unknown" | null;
  readonly hasSession: boolean;
};

export type AuditDetailView = {
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly name:          string;
  readonly date:          string;
  readonly finalOutcome:  "completed" | "stopped";
  readonly taskCount:     number;
  readonly acceptedCount: number;
  readonly skippedCount:  number;
  readonly tasks:         readonly AuditTaskItem[];
};

function auditTaskToItem(entry: WorkflowTaskAuditEntry): AuditTaskItem {
  return {
    taskIndex:    entry.taskIndex,
    input:        entry.input ?? "(no input recorded)",
    outcome:      entry.outcome,
    outcomeBadge: historyOutcomeBadge(entry.outcome),
    retryCount:   entry.retryCount,
    runtime:      entry.session?.runtime ?? null,
    hasSession:   entry.session !== null,
  };
}

export function workflowAuditToDetailView(
  record: WorkflowAuditRecord,
): AuditDetailView {
  return {
    workflowRunId: record.workflowRunId,
    executionInstanceId: record.executionInstanceId,
    name:          record.workflowName,
    date:          new Date(record.ts).toLocaleString(),
    finalOutcome:  record.finalOutcome,
    taskCount:     record.taskCount,
    acceptedCount: record.acceptedCount,
    skippedCount:  record.skippedCount,
    tasks:         record.tasks.map(auditTaskToItem),
  };
}
