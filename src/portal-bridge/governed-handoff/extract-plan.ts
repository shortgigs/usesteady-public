/**
 * Extract portal-facing execution plan fields from a governed draft record.
 * Zero authority — presentation only (INV-WL-4).
 */

import type { GovernedDecisionRecord } from "../../governed-decision/types.js";
import { ratifiableFingerprint } from "../../governed-decision/runner.js";

export type PortalExecutionPlanDraft = {
  readonly threadId: string;
  readonly recordId: string;
  readonly goal: string;
  readonly summary: string;
  readonly ops: readonly string[];
  readonly approvedPlanHash: string;
  readonly riskNotes: readonly string[];
};

function formatOperation(op: {
  readonly kind: string;
  readonly path?: string;
  readonly content?: string;
  readonly statement?: string;
}): string {
  if (op.kind === "create_dir" && typeof op.path === "string") {
    return `create directory ${op.path}`;
  }
  if (op.kind === "create_file" && typeof op.path === "string") {
    return op.content === "" ? `create file ${op.path}` : `create file ${op.path} (with content)`;
  }
  if (op.kind === "replace" && typeof op.path === "string") {
    return `replace text in ${op.path}`;
  }
  if (op.kind === "delete" && typeof op.path === "string") {
    return `delete ${op.path}`;
  }
  if (op.kind === "rename" && typeof op.path === "string") {
    return `rename ${op.path}`;
  }
  if (op.kind === "human_attest" && typeof op.statement === "string") {
    return `human attest: ${op.statement}`;
  }
  if (op.kind === "document_record" && typeof op.statement === "string") {
    return `document record: ${op.statement}`;
  }
  return op.kind;
}

export function extractExecutionPlanDraft(
  record: GovernedDecisionRecord,
  threadId: string,
): PortalExecutionPlanDraft | null {
  const goal =
    typeof record.humanIntent?.goal === "string" ? record.humanIntent.goal.trim() : "";
  if (goal.length === 0) return null;

  const approvedPlanHash = ratifiableFingerprint(record);
  if (approvedPlanHash === null) return null;

  const understanding = record.understanding;
  const ops: string[] = [];
  let summary = goal;

  if (understanding.status === "connected") {
    const plans = understanding.value.candidatePlans;
    if (plans.length > 0) {
      summary = plans.map((p) => p.summary).join("; ") || goal;
      for (const plan of plans) {
        if (plan.operation !== undefined) {
          ops.push(formatOperation(plan.operation as {
            kind: string;
            path?: string;
            content?: string;
            statement?: string;
          }));
        } else {
          ops.push(plan.summary);
        }
      }
    }
  }

  const riskNotes: string[] = [];
  const constitution = record.constitution;
  if (constitution.status === "connected") {
    for (const inv of constitution.value.appliedInvariants) {
      riskNotes.push(inv);
    }
  }

  return {
    threadId,
    recordId: record.recordId,
    goal,
    summary,
    ops,
    approvedPlanHash,
    riskNotes,
  };
}

export function isHandoffNotExecutable(record: GovernedDecisionRecord): boolean {
  if (record.understanding.status !== "connected") return true;
  return record.understanding.value.candidatePlans.length === 0;
}
