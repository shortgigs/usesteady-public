/**
 * usesteady timeline — read-only chronological workflow run view.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * Authority: zero. Reads UCP store via src/history/ only (+ taskInputs peel).
 */

import { resolveStoreDir } from "../defaults.js";
import { getWorkflowAuditRecord } from "../../history/workflow-history.js";
import {
  resolveExecutionInstance,
  resolveLastExecutionInstanceId,
} from "../../history/execution-instance-resolve.js";
import { projectTimelineView } from "../../history/timeline-projection.js";
import type { TimelineView } from "../../history/timeline-projection.js";
import { renderTimelineJson, renderTimelineText } from "../timeline-render.js";

export type TimelineCommandArgs =
  | { readonly mode: "help" }
  | { readonly mode: "last" }
  | { readonly mode: "run-id"; readonly runId: string };

export type TimelineOutputFormat = "text" | "json";

/** Advanced override for tests; not advertised in v1 help text. */
export function resolveTimelineStoreDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveStoreDir(env);
}

export function parseTimelineArgs(argv: readonly string[]): TimelineCommandArgs | "usage-error" {
  let help = false;
  let last = false;
  let runId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (tok === "--help" || tok === "-h") {
      help = true;
      continue;
    }
    if (tok === "--last") {
      last = true;
      continue;
    }
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

  if (help) return { mode: "help" };
  if (last && runId !== undefined) return "usage-error";
  if (last) return { mode: "last" };
  if (runId !== undefined) return { mode: "run-id", runId };
  return "usage-error";
}

function loadTaskInputs(storeDir: string, workflowRunId: string): readonly (string | null)[] {
  const resolved = resolveExecutionInstance(storeDir, workflowRunId);
  if (resolved.kind !== "ok") return [];
  return resolved.envelope.payload.taskInputs ?? [];
}

function resolveLastRunId(storeDir: string): string | null {
  return resolveLastExecutionInstanceId(storeDir);
}

export function buildTimelineView(
  storeDir: string,
  args: TimelineCommandArgs,
): TimelineView {
  if (args.mode === "help") {
    throw new Error("buildTimelineView: help mode");
  }

  let runId: string | null;
  if (args.mode === "last") {
    runId = resolveLastRunId(storeDir);
    if (runId === null) return { kind: "empty" };
  } else {
    runId = args.runId;
  }

  const audit = getWorkflowAuditRecord(storeDir, runId);
  if (audit === null) {
    // K7-I1 / K7-I2: audit-null always → incomplete; no secondary artifact scans.
    return { kind: "incomplete", runId };
  }

  const taskInputs = loadTaskInputs(storeDir, runId);
  return projectTimelineView(audit, taskInputs);
}

export type TimelineRunResult = {
  readonly text?: string;
  readonly json?: string;
  readonly exitCode: number;
};

export function runTimeline(
  args: TimelineCommandArgs,
  storeDir: string = resolveTimelineStoreDir(),
  format: TimelineOutputFormat = "text",
): TimelineRunResult {
  const view = buildTimelineView(storeDir, args);
  if (format === "json") {
    return {
      json:     renderTimelineJson(view),
      exitCode: 0,
    };
  }
  return {
    text:     renderTimelineText(view),
    exitCode: 0,
  };
}
