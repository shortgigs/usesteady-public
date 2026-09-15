/**
 * Derive ApprovedPlanStub from a ratified governed draft (FS ops only).
 */

import type { GovernedDecisionRecord } from "../types.js";
import type { ApprovedPlanStub } from "./types.js";

/**
 * Extract sealable FS artifacts from a draft record.
 * Returns null when there is nothing to project (no create_file / create_dir).
 */
export function approvedPlanFromDraft(input: {
  readonly record: GovernedDecisionRecord;
  readonly planId: string;
  readonly approvalSeal: string;
  readonly policySeals?: readonly string[];
}): ApprovedPlanStub | null {
  const { record, planId, approvalSeal } = input;
  if (record.understanding.status !== "connected") return null;

  const artifacts: Record<string, string> = {};
  const dirs: string[] = [];
  let intent = record.humanIntent?.goal?.trim() ?? "";

  for (const plan of record.understanding.value.candidatePlans) {
    if (!intent && plan.summary) intent = plan.summary;
    const op = plan.operation;
    if (!op) continue;
    if (op.kind === "create_file") {
      artifacts[op.path.replace(/\\/g, "/")] = op.content;
    } else if (op.kind === "create_dir") {
      dirs.push(op.path.replace(/\\/g, "/"));
    }
  }

  if (Object.keys(artifacts).length === 0 && dirs.length === 0) {
    return null;
  }

  return {
    plan_id: planId,
    intent_summary: intent || planId,
    artifacts,
    dirs,
    policy_seals: input.policySeals ?? [],
    approval_seal: approvalSeal,
    approved_by: "H",
  };
}
