/**
 * Governed-decision CLI output helpers: JSON envelope (schemaVersion 1.0) and TTY
 * authority checks. Pure formatting — no store mutations, no ratification.
 */

import type { InvocationLineage } from "./lineage.js";
import type { GovernedDecisionProjection } from "./projection.js";
import type { ElicitationOutcome } from "./elicitation.js";
import type { Reference, GovernedDecisionRecord } from "./types.js";
import type { UseSteadyCLIResponseShape } from "./cli-schemas.js";

export type CliCommand = "decide" | "ratify" | "show" | "lineage" | "decisions";

export type CliStatus =
  | "success"
  | "draft"
  | "awaiting_ratification"
  | "needs_input"
  | "error";

export function isInteractiveTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function localCertification(): { status: "unknown"; source: "local" } {
  return { status: "unknown", source: "local" };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type CliJsonEnvelope = {
  schemaVersion: "1.0";
  command: CliCommand;
  status: CliStatus;
  recordId?: string | null;
  timestamp: string;
  data: unknown;
  message?: string;
  nextSteps?: string[];
  error?: { code: string; message: string; details?: unknown };
  certification?: { status: "unknown" | "connected" | "verified"; source?: "local" | "portal" };
};

export function emitJsonLine(out: (line: string) => void, payload: CliJsonEnvelope): void {
  out(JSON.stringify(payload));
}

export function errorResponse(
  command: CliCommand,
  code: string,
  message: string,
  details?: unknown,
): CliJsonEnvelope {
  return {
    schemaVersion: "1.0",
    command,
    status: "error",
    recordId: null,
    timestamp: nowIso(),
    data: null,
    message,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    certification: localCertification(),
  };
}

export function elicitationQuestions(
  elicitation: ElicitationOutcome,
): Array<{ id: string; question: string; type: "text" }> | null {
  if (elicitation.status !== "needs_input") return null;
  return elicitation.questions.map((question, index) => ({
    id: `q${index + 1}`,
    question,
    type: "text" as const,
  }));
}

export function refsToJson(refs: readonly Reference[]): Array<{ kind: string; ref: string }> {
  return refs.map((r) => ({ kind: r.kind, ref: r.ref }));
}

/** Derive agent-friendly projection fields from a stored record (gauge-law honest). */
export function buildDecideProjection(
  record: GovernedDecisionRecord,
  projection: GovernedDecisionProjection,
): {
  summary: string;
  filesToChange: readonly string[];
  estimatedImpact?: "low" | "medium" | "high";
  SYSTEM_WILL?: string;
} {
  const understanding = projection.sections.find((s) => s.stage === "understanding");
  const constitution = projection.sections.find((s) => s.stage === "constitution");

  const summaryParts: string[] = [];
  if (understanding !== undefined && understanding.status !== "unavailable") {
    summaryParts.push(understanding.display);
  } else if (understanding !== undefined) {
    summaryParts.push(`understanding unavailable: ${understanding.reason}`);
  }
  if (constitution !== undefined && constitution.status !== "unavailable") {
    summaryParts.push(constitution.display);
  }

  const filesToChange: string[] = [];
  const understandingSection = record.understanding;
  if (understandingSection.status === "connected" || understandingSection.status === "derived") {
    for (const plan of understandingSection.value.candidatePlans) {
      const op = plan.operation;
      if (op !== undefined && typeof op.path === "string" && op.path.length > 0) {
        filesToChange.push(op.path);
      }
    }
  }

  const systemWillParts: string[] = [];
  if (understanding !== undefined && understanding.status !== "unavailable") {
    systemWillParts.push(understanding.display);
  }
  if (constitution !== undefined && constitution.status !== "unavailable") {
    systemWillParts.push(constitution.display);
  }

  const opCount = filesToChange.length;
  const estimatedImpact: "low" | "medium" | "high" | undefined =
    opCount === 0 ? undefined : opCount === 1 ? "low" : opCount <= 3 ? "medium" : "high";

  return {
    summary: summaryParts.length > 0 ? summaryParts.join(" | ") : projection.humanIntent.goal,
    filesToChange: [...filesToChange],
    ...(estimatedImpact !== undefined ? { estimatedImpact } : {}),
    ...(systemWillParts.length > 0 ? { SYSTEM_WILL: systemWillParts.join(" | ") } : {}),
  };
}

export function lineageToJsonData(lineage: InvocationLineage): {
  root: string;
  nodes: readonly unknown[];
  edges: readonly unknown[];
  certification?: UseSteadyCLIResponseShape<unknown>["certification"];
} {
  return {
    root: lineage.root,
    nodes: lineage.nodes,
    edges: lineage.edges,
    certification: localCertification(),
  };
}
