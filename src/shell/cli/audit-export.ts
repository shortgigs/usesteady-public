/**
 * usesteady audit export — read-only workflow run export bundle.
 *
 * P0-3: exports existing UCP store fields only. Zero authority — no
 * enforcement, signing, encryption, or store mutation.
 *
 * D2 boundary: `tasks`/`timeline` are SessionChain-derived (WorkflowAuditRecord
 * + timeline projection). `artifacts` are RunTimeline-derived (getTimeline per
 * intentId). Separate top-level arrays — never merged into one chain.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getTimeline, type RunTimeline } from "../../ucp/persistence/query.js";
import { getWorkflowAuditRecord } from "../../history/workflow-history.js";
import { resolveExecutionInstance } from "../../history/execution-instance-resolve.js";
import { projectTimelineView, type TimelineTaskRow } from "../../history/timeline-projection.js";
import type {
  WorkflowAuditRecord,
  WorkflowTaskAuditEntry,
} from "../../history/types.js";
import { assessLocalEvidence, type EvidenceAssessment } from "../../history/evidence-assessment.js";
import { resolveStoreDir } from "../defaults.js";

export type AuditExportOutputMode = "json" | "file";

export type AuditExportCommandArgs =
  | { readonly mode: "help" }
  | { readonly mode: "export"; readonly runId: string; readonly output: AuditExportOutputMode };

export type AuditExportBundle = {
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly workflowName:  string;
  readonly finalOutcome:  "completed" | "stopped";
  readonly tasks:         readonly WorkflowTaskAuditEntry[];
  readonly timeline:      readonly TimelineTaskRow[];
  readonly artifacts:     readonly AuditExportArtifactEntry[];
  readonly evidence: {
    readonly assessment: EvidenceAssessment;
    readonly assessedScope: "selected-terminal-envelope-only";
    readonly executionDetail: "NOT_ESTABLISHED";
    readonly authenticatedActor: "NOT_ESTABLISHED";
    readonly explanation: string;
  };
};

export type AuditExportArtifactEntry = {
  readonly taskIndex: number;
  readonly intentId:  string;
  readonly intent:            RunTimeline["intent"];
  readonly response:          RunTimeline["response"];
  readonly artifact:          RunTimeline["artifact"];
  readonly trace:             RunTimeline["trace"];
  readonly replay:            RunTimeline["replay"];
  readonly reminderExecution: RunTimeline["reminderExecution"];
};

export type AuditExportError =
  | { readonly kind: "missing_run_id" }
  | { readonly kind: "run_not_found"; readonly runId: string }
  | { readonly kind: "ambiguous_run_id"; readonly runId: string; readonly instanceIds: readonly string[] };

export type AuditExportResult =
  | { readonly kind: "ok"; readonly bundle: AuditExportBundle; readonly filePath?: string }
  | { readonly kind: "error"; readonly error: AuditExportError };

/** Advanced override for tests; not advertised in v1 help text. */
export function resolveAuditExportStoreDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveStoreDir(env);
}

export function parseAuditExportArgs(
  argv: readonly string[],
  outputMode: AuditExportOutputMode | null,
): AuditExportCommandArgs | "usage-error" {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { mode: "help" };
  }

  if (argv[0] !== "export") {
    return "usage-error";
  }

  let runId: string | undefined;
  for (let i = 1; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (tok === "--run-id") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) return "usage-error";
      runId = next;
      i += 1;
      continue;
    }
    if (tok.startsWith("--run-id=")) {
      const value = tok.slice("--run-id=".length);
      if (value.length === 0) return "usage-error";
      runId = value;
      continue;
    }
    if (tok.startsWith("-")) return "usage-error";
    return "usage-error";
  }

  if (runId === undefined) {
    return "usage-error";
  }

  return {
    mode:   "export",
    runId,
    output: outputMode ?? "json",
  };
}

function collectArtifacts(
  storeDir: string,
  audit: WorkflowAuditRecord,
): readonly AuditExportArtifactEntry[] {
  const entries: AuditExportArtifactEntry[] = [];
  for (const task of audit.tasks) {
    const session = task.session;
    const intentId = session?.intentId ?? null;
    if (intentId === null || intentId.length === 0) continue;
    const runTimeline = getTimeline(storeDir, intentId);
    entries.push({
      taskIndex: task.taskIndex,
      intentId,
      intent:            runTimeline.intent,
      response:          runTimeline.response,
      artifact:          runTimeline.artifact,
      trace:             runTimeline.trace,
      replay:            runTimeline.replay,
      reminderExecution: runTimeline.reminderExecution,
    });
  }
  return entries;
}

export function buildAuditExportBundle(
  storeDir: string,
  runId: string,
): AuditExportResult {
  const resolved = resolveExecutionInstance(storeDir, runId);
  if (resolved.kind === "ambiguous") {
    return { kind: "error", error: { kind: "ambiguous_run_id", runId, instanceIds: resolved.instanceIds } };
  }
  const audit = getWorkflowAuditRecord(storeDir, runId);
  if (audit === null) {
    return { kind: "error", error: { kind: "run_not_found", runId } };
  }

  const taskInputs = Array.from({ length: audit.taskCount }, (_, index) => audit.tasks.find(task => task.taskIndex === index)?.input ?? null);
  const timelineView = projectTimelineView(audit, taskInputs);
  const timelineRows = timelineView.kind === "run" ? timelineView.tasks : [];

  const bundle: AuditExportBundle = {
    workflowRunId: audit.workflowRunId,
    executionInstanceId: audit.executionInstanceId,
    workflowName:  audit.workflowName,
    finalOutcome:  audit.finalOutcome,
    tasks:         audit.tasks,
    timeline:      timelineRows,
    artifacts:     collectArtifacts(storeDir, audit),
    evidence: {
      assessment: assessLocalEvidence(storeDir, {
        required: [{ id: audit.envelopeId, type: "ucp.workflow_run.v1" }],
        declaredStorage: "supplied-local-unclassified",
      }),
      assessedScope: "selected-terminal-envelope-only",
      executionDetail: "NOT_ESTABLISHED",
      authenticatedActor: "NOT_ESTABLISHED",
      explanation: "Terminal outcome is not evidence completeness. Session records lack execution-bound references and are withheld. No trusted log reference, independent custody, retention guarantee, or authenticated local approver is established by this export. The supplied local path has not been classified as temporary or persistent. Signed Portal authority is a distinct surface, not assessed here.",
    },
  };

  return { kind: "ok", bundle };
}

export function auditExportFilePath(runId: string, cwd: string = process.cwd()): string {
  return join(cwd, "audit-exports", `${runId}.json`);
}

export function renderAuditExportJson(result: AuditExportResult): string {
  if (result.kind === "error") {
    if (result.error.kind === "missing_run_id") {
      return JSON.stringify({ success: false, error: "missing_run_id" }) + "\n";
    }
    if (result.error.kind === "ambiguous_run_id") {
      return JSON.stringify({
        success: false,
        error:   "ambiguous_run_id",
        runId:   result.error.runId,
        instanceIds: result.error.instanceIds,
      }) + "\n";
    }
    return JSON.stringify({
      success: false,
      error:   "run_not_found",
      runId:   result.error.runId,
    }) + "\n";
  }

  return JSON.stringify(result.bundle) + "\n";
}

export type AuditExportRunResult = {
  readonly stdout:   string;
  readonly exitCode: number;
};

export function runAuditExport(
  args: AuditExportCommandArgs,
  options: {
    readonly storeDir?: string;
    readonly cwd?: string;
  } = {},
): AuditExportRunResult {
  if (args.mode === "help") {
    return { stdout: renderAuditExportHelpText(), exitCode: 0 };
  }

  const storeDir = options.storeDir ?? resolveAuditExportStoreDir();
  const cwd = options.cwd ?? process.cwd();
  const built = buildAuditExportBundle(storeDir, args.runId);

  if (built.kind === "error") {
    return {
      stdout:   renderAuditExportJson(built),
      exitCode: 1,
    };
  }

  const json = renderAuditExportJson(built);

  if (args.output === "file") {
    const filePath = auditExportFilePath(args.runId, cwd);
    mkdirSync(join(cwd, "audit-exports"), { recursive: true });
    writeFileSync(filePath, json, "utf8");
    return {
      stdout: JSON.stringify({ success: true, path: filePath }) + "\n",
      exitCode: 0,
    };
  }

  return { stdout: json, exitCode: 0 };
}

export function renderAuditExportHelpText(): string {
  return (
    "\n" +
    "  usesteady audit export — no state mutation (stdout / --output json)\n\n" +
    "  Usage:\n" +
    "    usesteady audit export --run-id <executionInstanceId>\n" +
    "    usesteady audit export --run-id <executionInstanceId> --output json\n" +
    "    usesteady audit export --run-id <executionInstanceId> --output file\n\n" +
    "  --run-id selects one execution instance (not the spec identity).\n" +
    "  A spec id that matches two instances is refused (ambiguous).\n" +
    "  Legacy records without an instance id still resolve by their\n" +
    "  original single run id.\n\n" +
    "  Exports existing store fields only. Does not execute, approve,\n" +
    "  sign, encrypt, or mutate the store.\n\n" +
    "  --output json   Write export JSON to stdout (default; no state mutation).\n" +
    "  --output file   Write export JSON to ./audit-exports/<run-id>.json\n" +
    "                  (no governed effect; writes that file — not no-state-mutation).\n\n"
  );
}

export function renderMissingRunIdError(): string {
  return (
    "\n  Error: `audit export` requires --run-id <executionInstanceId>\n" +
    "  Usage: usesteady audit export --run-id <id> [--output json|file]\n\n"
  );
}
