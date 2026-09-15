/**
 * Timeline shell rendering — pure text + JSON projection.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * No I/O. No store reads. No authority.
 */

import type {
  TimelineRunView,
  TimelineView,
} from "../history/timeline-projection.js";
import { stoppedAtTaskOneBased } from "../history/timeline-projection.js";

export const TIMELINE_DISCLAIMER_LINES = [
  "Timeline is a read-only audit view. It does not execute steps, approve changes,",
  "resume workflows, or replay artifacts. Passing display does not grant permission",
  "to run anything without your explicit approval.",
] as const;

/** K7-I4: test-enforced forbidden JSON keys for timeline output. */
export const TIMELINE_FORBIDDEN_JSON_KEYS = [
  "actions",
  "resume",
  "resumable",
  "continue",
  "canResume",
  "resumeToken",
  "nextStep",
  "nextTaskIndex",
  "progress",
  "percentComplete",
  "currentTaskIndex",
  "completedTaskCount",
  "executionSessionId",
  "suggestedAction",
  "safeToExecute",
  "approved",
  "liveRun",
  "phase",
  "runTimeline",
  "intentChains",
] as const;

const EM_DASH = "\u2014";

function formatRunEnded(ts: number): string {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
}

function formatTaskTime(ts: number | null): string {
  if (ts === null) return EM_DASH;
  const iso = new Date(ts).toISOString();
  return iso.slice(11, 19);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "\u2026";
}

function formatOutcome(outcome: TimelineRunView["tasks"][number]["outcome"]): string {
  return outcome ?? EM_DASH;
}

function finalLine(view: TimelineRunView): string {
  if (view.finalOutcome === "completed") {
    return `Final:    completed (${view.taskCount}/${view.taskCount})`;
  }
  const k = stoppedAtTaskOneBased(view.tasks);
  return `Final:    stopped at task ${k}/${view.taskCount}`;
}

function renderTable(view: TimelineRunView): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "  #  Task                 State          Started     Ended       Outcome",
  );

  for (const row of view.tasks) {
    const num = String(row.taskIndex).padEnd(2);
    const task = truncate(row.input ?? EM_DASH, 20).padEnd(20);
    const state = row.displayState.padEnd(14);
    const started = formatTaskTime(row.startedTs).padEnd(11);
    const ended = formatTaskTime(row.endedTs).padEnd(11);
    const outcome = formatOutcome(row.outcome);
    lines.push(`  ${num} ${task} ${state} ${started} ${ended} ${outcome}`);
  }

  return lines;
}

export function renderTimelineIncompleteText(runId: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  [incomplete ${EM_DASH} no terminal record]`);
  lines.push(`  Run id: ${runId}`);
  lines.push("");
  lines.push("  No ucp.workflow_run.v1 envelope exists for this run id.");
  lines.push(
    "  Timeline cannot show a step-by-step narrative without a terminal workflow record.",
  );
  lines.push(
    "  Per-task delivery envelopes may exist in the store, but v1.1 does not use them",
  );
  lines.push("  to reconstruct task rows, progress, or resumability.");
  lines.push("");
  for (const line of TIMELINE_DISCLAIMER_LINES) {
    lines.push(`  ${line}`);
  }
  lines.push("");
  lines.push("  Full audit envelopes: usesteady history");
  lines.push("");
  return lines.join("\n");
}

export function renderTimelineText(view: TimelineView): string {
  if (view.kind === "empty") {
    return "No workflow runs in store.\n";
  }

  if (view.kind === "incomplete") {
    return renderTimelineIncompleteText(view.runId);
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(
    `  Workflow: ${view.workflowName}  (run id: ${view.executionInstanceId})`,
  );
  lines.push(finalLine(view));
  lines.push(`  Ended:    ${formatRunEnded(view.runEndedTs)}`);
  lines.push(...renderTable(view));
  lines.push("");
  for (const line of TIMELINE_DISCLAIMER_LINES) {
    lines.push(`  ${line}`);
  }
  lines.push("");
  lines.push("  Full audit envelopes: usesteady history");
  lines.push("");
  return lines.join("\n");
}

function runViewToJson(view: TimelineRunView): Record<string, unknown> {
  return {
    kind:          "run",
    readOnly:      true,
    workflowRunId: view.workflowRunId,
    executionInstanceId: view.executionInstanceId,
    workflowName:  view.workflowName,
    finalOutcome:  view.finalOutcome,
    taskCount:     view.taskCount,
    runEndedTs:    view.runEndedTs,
    tasks:         view.tasks.map((row) => ({
      taskIndex:    row.taskIndex,
      input:        row.input,
      displayState: row.displayState,
      outcome:      row.outcome,
      startedTs:    row.startedTs,
      endedTs:      row.endedTs,
      retryCount:   row.retryCount,
    })),
  };
}

export function renderTimelineJson(view: TimelineView): string {
  if (view.kind === "empty") {
    return JSON.stringify({
      kind:     "empty",
      readOnly: true,
      message:  "No workflow runs in store.",
    }) + "\n";
  }

  if (view.kind === "incomplete") {
    return JSON.stringify({
      kind:       "incomplete",
      readOnly:   true,
      incomplete: true,
      reason:     "no_terminal_workflow_record",
      runId:      view.runId,
      tasks:      [],
    }) + "\n";
  }

  return JSON.stringify(runViewToJson(view)) + "\n";
}

export function renderTimelineHelpText(): string {
  return (
    "\n" +
    "  usesteady timeline — read-only chronological view of one workflow run\n\n" +
    "  Usage:\n" +
    "    usesteady timeline --last\n" +
    "    usesteady timeline --run-id <workflowRunId>\n" +
    "    usesteady timeline --last --output json\n" +
    "    usesteady timeline --run-id <workflowRunId> --output json\n\n" +
    "  Shows a step-by-step table for a terminal (completed or stopped) run.\n" +
    "  When no terminal record exists, shows an incomplete banner (no partial rows).\n" +
    "  To browse all runs and delivery envelopes, use `usesteady history`.\n\n"
  );
}
