/**
 * usesteady audit summary — read-only operational insights (P3).
 *
 * Projection over existing UCP store only. No scoring, inference, or mutation.
 * Resume events and unattributed provider activity report unknown.
 */

import { getWorkflowAuditRecord } from "../../history/workflow-history.js";
import { resolveLastExecutionInstanceId } from "../../history/execution-instance-resolve.js";
import type { HistoryTaskOutcome, SessionChain, WorkflowAuditRecord } from "../../history/types.js";
import { resolveStoreDir } from "../defaults.js";

export type AuditSummaryCommandArgs =
  | { readonly mode: "help" }
  | { readonly mode: "last" };

export type AuditRunSummary = {
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly outcome: "completed" | "stopped";
  readonly tasks: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly retries: number;
  readonly resumeEvents: number | "unknown";
  readonly providerCalls: number | "unknown";
};

export type AuditSummaryView =
  | { readonly kind: "empty" }
  | { readonly kind: "run"; readonly summary: AuditRunSummary };

export function resolveAuditSummaryStoreDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveStoreDir(env);
}

export function parseAuditSummaryArgs(argv: readonly string[]): AuditSummaryCommandArgs | "usage-error" {
  let help = false;
  let last = false;

  for (const tok of argv) {
    if (tok === "--help" || tok === "-h") {
      help = true;
      continue;
    }
    if (tok === "--last") {
      last = true;
      continue;
    }
    if (tok.startsWith("-")) return "usage-error";
    return "usage-error";
  }

  if (help) return { mode: "help" };
  if (last) return { mode: "last" };
  return "usage-error";
}

function resolveLastRunId(storeDir: string): string | null {
  return resolveLastExecutionInstanceId(storeDir);
}

function hasObservedClaudeDelivery(session: SessionChain | null): boolean {
  if (session === null) return false;
  return session.claudeHandoff !== null
    || session.claudeReceipt !== null
    || session.claudeRefused !== null;
}

function isSkippedOutcome(outcome: HistoryTaskOutcome): boolean {
  return outcome === "skipped"
    || outcome === "skipped_by_intake"
    || outcome === "stopped";
}

export function projectAuditRunSummary(audit: WorkflowAuditRecord): AuditRunSummary {
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  let retries = 0;
  let providerCalls = 0;

  for (const task of audit.tasks) {
    if (task.outcome === "accepted") accepted += 1;
    else if (task.outcome === "rejected") rejected += 1;
    else if (isSkippedOutcome(task.outcome)) skipped += 1;
    retries += Math.max(0, task.retryCount);
    if (hasObservedClaudeDelivery(task.session)) providerCalls += 1;
  }

  return {
    workflowRunId: audit.workflowRunId,
    executionInstanceId: audit.executionInstanceId,
    outcome:       audit.finalOutcome,
    tasks:         audit.taskCount,
    accepted,
    rejected,
    skipped,
    retries,
    resumeEvents:  "unknown",
    providerCalls: audit.tasks.some(task => task.session === null) ? "unknown" : providerCalls,
  };
}

export function buildAuditSummaryView(
  storeDir: string,
  args: AuditSummaryCommandArgs,
): AuditSummaryView {
  if (args.mode === "help") {
    throw new Error("buildAuditSummaryView: help mode");
  }

  const runId = resolveLastRunId(storeDir);
  if (runId === null) return { kind: "empty" };

  const audit = getWorkflowAuditRecord(storeDir, runId);
  if (audit === null) return { kind: "empty" };

  return {
    kind:    "run",
    summary: projectAuditRunSummary(audit),
  };
}

function formatCountOrUnknown(value: number | "unknown"): string {
  return value === "unknown" ? "unknown" : String(value);
}

export function renderAuditSummaryText(view: AuditSummaryView): string {
  if (view.kind === "empty") {
    return "\n  No workflow runs found in store.\n\n";
  }

  const s = view.summary;
  return [
    "",
    "  Audit summary:",
    `  Run: ${s.executionInstanceId}`,
    `  Outcome: ${s.outcome}`,
    `  Tasks: ${s.tasks}`,
    `  Accepted: ${s.accepted}`,
    `  Rejected: ${s.rejected}`,
    `  Skipped: ${s.skipped}`,
    `  Retries: ${s.retries}`,
    `  Resume events: ${formatCountOrUnknown(s.resumeEvents)}`,
    `  Provider calls: ${formatCountOrUnknown(s.providerCalls)}`,
    "",
    "  No state mutation. Projection from store artifacts. No scoring or inference.",
    "",
  ].join("\n");
}

export function renderAuditSummaryJson(view: AuditSummaryView): string {
  if (view.kind === "empty") {
    return JSON.stringify({ auditSummary: null }) + "\n";
  }
  return JSON.stringify({ auditSummary: view.summary }) + "\n";
}

export type AuditSummaryRunResult = {
  readonly stdout: string;
  readonly exitCode: 0 | 2;
};

export function runAuditSummary(
  args: AuditSummaryCommandArgs,
  storeDir: string = resolveAuditSummaryStoreDir(),
  format: "text" | "json" = "text",
): AuditSummaryRunResult {
  const view = buildAuditSummaryView(storeDir, args);
  return {
    stdout:   format === "json" ? renderAuditSummaryJson(view) : renderAuditSummaryText(view),
    exitCode: 0,
  };
}

export function renderAuditSummaryHelpText(): string {
  return (
    "\n  usesteady audit summary — no state mutation (operational insights)\n\n" +
    "  Usage:\n" +
    "    usesteady audit summary --last\n" +
    "    usesteady audit summary --last --output json\n\n" +
    "  Projects approval/retry/skip counts from existing store artifacts only.\n" +
    "  Resume events report unknown unless recorded in store. No scoring.\n\n"
  );
}

export function renderAuditCommandHelpText(): string {
  return (
    "\n  usesteady audit — no state mutation (store projections)\n\n" +
    "  Subcommands:\n" +
    "    audit export --run-id <id> [--output json|file]\n" +
    "    audit summary --last [--output json]\n\n" +
    "  Does not execute, approve, score, or mutate the store.\n\n"
  );
}

export function renderAuditSummaryUsageError(): string {
  return (
    "\n  Error: use `usesteady audit summary --last`\n\n"
  );
}
