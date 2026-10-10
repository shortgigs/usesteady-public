/**
 * Phase 10C: History / Audit shell rendering.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure function that maps HistoryView state → ShellFrame.
 *   No I/O. No store reads. No authority.
 *
 * ── Two views ─────────────────────────────────────────────────────────────────
 *
 *   list   — WorkflowHistorySummary[] rendered as a numbered list.
 *            Prompt: "choose" so the user can select a run by number.
 *            When empty: no prompt (terminal — CLI loop exits or re-prompts).
 *
 *   detail — WorkflowAuditRecord rendered as full per-task session chain.
 *            Prompt: "confirm" to return to list.
 *
 * ── Key invariants (HR1–HR4) ──────────────────────────────────────────────────
 *
 *   HR1: Pure — no side effects, no store reads, no I/O.
 *   HR2: No live WorkflowRun objects enter this module.
 *        The view types carry already-resolved read-model data.
 *   HR3: Empty history list renders with no prompt (loop can exit cleanly).
 *        A choose prompt is only emitted when there is at least one run.
 *   HR4: Session chain detail (cursor/claude, handoff/receipt/refused) is
 *        rendered for every task that has a non-null session. Tasks with
 *        null session render as "(no session)".
 *
 * See: docs/phase-10a-history-audit-design.md — design record
 *      docs/phase-10c-baseline.md             — freeze record
 */

import type { WorkflowHistorySummary, WorkflowAuditRecord, SessionChain, HistoryTaskOutcome } from "../history/types.js";
import type { ShellFrame } from "./types.js";

// ─── Input type ───────────────────────────────────────────────────────────────

/**
 * HistoryView — the union of views the history shell can render.
 *
 * list   — summary list of all persisted workflow runs
 * detail — full audit record for one selected run
 */
export type HistoryView =
  | { readonly kind: "list";   readonly summaries: readonly WorkflowHistorySummary[] }
  | { readonly kind: "detail"; readonly record:    WorkflowAuditRecord };

// ─── Formatting helpers ───────────────────────────────────────────────────────

const DIVIDER = "─".repeat(52);

function header(label: string): string {
  return `${DIVIDER}\n  ${label}\n${DIVIDER}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function outcomeTag(outcome: HistoryTaskOutcome): string {
  switch (outcome) {
    case "accepted":           return "[done]";
    case "skipped":            return "[skip]";
    case "skipped_by_intake":  return "[auto]";
    case "stopped":            return "[stop]";
    case "rejected":           return "[reject]";
    case "pending":            return "[...]";
    case "planning_reviewed":  return "[plan]";
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ─── List view ────────────────────────────────────────────────────────────────

function renderList(summaries: readonly WorkflowHistorySummary[]): ShellFrame {
  const lines: string[] = [];
  lines.push(header("Workflow History"));
  lines.push("");

  if (summaries.length === 0) {
    lines.push("  No workflow runs found.");
    lines.push("");
    // HR3: no prompt when list is empty.
    return { lines };
  }

  lines.push(`  ${summaries.length} run${summaries.length === 1 ? "" : "s"} found.`);
  lines.push("");

  const choices: string[] = [];

  for (let i = 0; i < summaries.length; i++) {
    const s   = summaries[i]!;
    const tag = s.finalOutcome === "completed" ? "completed" : "stopped  ";
    const stats = `${s.acceptedCount}/${s.taskCount} accepted`;
    const row = `${s.workflowName}  ·  ${tag}  ·  ${formatDate(s.ts)}  ·  ${stats}`;
    lines.push(`  ${i + 1}.  [${shortId(s.executionInstanceId)}]  ${row}`);
    choices.push(row);
  }

  lines.push("");

  return {
    lines,
    prompt: {
      kind:     "choose",
      question: "Select run to inspect:",
      choices,
    },
  };
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function renderSessionChainLines(session: SessionChain): readonly string[] {
  const lines: string[] = [];
  lines.push(`    runtime   ${session.runtime}`);

  if (session.cursorHandoff) {
    lines.push(`    handoff   persisted`);
    if (session.cursorReceipt) {
      lines.push(`    receipt   accepted`);
    } else if (session.cursorRefused) {
      const p = session.cursorRefused.payload;
      const kind = (p as { refusalKind?: string }).refusalKind ?? "refused";
      const sub  = (p as { scopeQuestionKind?: string }).scopeQuestionKind;
      lines.push(`    refused   ${kind}${sub ? `  [${sub}]` : ""}`);
    }
  } else if (session.claudeHandoff) {
    lines.push(`    handoff   persisted`);
    if (session.claudeReceipt) {
      lines.push(`    receipt   accepted`);
    } else if (session.claudeRefused) {
      const p = session.claudeRefused.payload;
      const kind = (p as { refusalKind?: string }).refusalKind ?? "refused";
      lines.push(`    refused   ${kind}`);
    }
  }

  return lines;
}

function renderDetail(record: WorkflowAuditRecord): ShellFrame {
  const lines: string[] = [];
  const tag = record.finalOutcome === "completed" ? "completed" : "stopped";
  lines.push(header("Workflow Audit"));
  lines.push("");
  lines.push(`  ${record.workflowName}`);
  lines.push(`  outcome    ${tag}`);
  lines.push(`  run id     ${shortId(record.executionInstanceId)}`);
  lines.push(`  date       ${formatDate(record.ts)}`);
  lines.push(`  tasks      ${record.acceptedCount}/${record.taskCount} accepted`);
  lines.push("");

  if (record.tasks.length === 0) {
    lines.push("  No tasks ran.");
    lines.push("");
  }

  for (const task of record.tasks) {
    const inputText = task.input ? `"${task.input}"` : "(no input)";
    lines.push(`  Task ${task.taskIndex + 1}  ${inputText}`);
    lines.push(`    outcome   ${outcomeTag(task.outcome)}   retries: ${task.retryCount}`);

    if (task.session === null) {
      lines.push(`    session   (unavailable: not execution-bound)`);
    } else {
      for (const line of renderSessionChainLines(task.session)) {
        lines.push(line);
      }
    }

    lines.push("");
  }

  return {
    lines,
    prompt: {
      kind:     "confirm",
      question: "Return to list? (Enter / y  or 'exit')",
    },
  };
}

// ─── Main render function ─────────────────────────────────────────────────────

/**
 * Render a HistoryView into a ShellFrame.
 *
 * Pure. No I/O. No store reads.
 * Follows the same ShellFrame contract as renderCursorFrame, renderClaudeFrame,
 * and renderWorkflowFrame — prompt.kind ("confirm" or "choose") is the only
 * discriminant the CLI loop needs.
 */
export function renderHistoryFrame(view: HistoryView): ShellFrame {
  switch (view.kind) {
    case "list":   return renderList(view.summaries);
    case "detail": return renderDetail(view.record);
  }
}
