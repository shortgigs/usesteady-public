/**
 * proposeBlockedRevise — BER S2 (AI_SEAMS_V1_REV_2).
 *
 * Re-enters the candidate-plan gate with refuse context + operator revision.
 * Returns CandidatePlanOutcome (candidate | none). Fail-closed (INV-AI-3).
 * Never executes. Never CERT. Never stamps SYSTEM WILL.
 */

import { createHash } from "node:crypto";
import {
  createProposerModelCall,
  proposerRuntimeLabel,
  type ProposerModelCall,
} from "../ai-seams/proposer-model-call.js";
import { isBlockedExplainRefuseCode } from "../blocked-explain/types.js";
import { generateCandidatePlan } from "../candidate-plan/gate.js";
import type { CandidatePlanOutcome } from "../candidate-plan/types.js";
import { BlockedReviseAdapter } from "./adapter.js";
import { buildReviseZest } from "./build-revise-zest.js";
import type { BlockedReviseContext } from "./types.js";

export type BlockedReviseModelCall = ProposerModelCall;

const defaultCall = createProposerModelCall({ maxTokens: 2048 });

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function none(reason: string): CandidatePlanOutcome {
  return { kind: "none", reason, violations: [] };
}

/**
 * Propose a revised candidate plan at a refuse wall.
 * Always returns an outcome — never throws into an executor path.
 */
export async function proposeBlockedRevise(
  ctx: BlockedReviseContext,
  callModel: BlockedReviseModelCall = defaultCall,
  deps: { readonly modelRuntime?: string | null } = {},
): Promise<CandidatePlanOutcome> {
  if (!isBlockedExplainRefuseCode(ctx.refuseCode)) {
    return none("invalid_refuse_code");
  }
  if (
    typeof ctx.workItemId !== "string" ||
    ctx.workItemId.trim().length === 0
  ) {
    return none("missing_work_item");
  }
  if (
    typeof ctx.baselinePlanHash !== "string" ||
    ctx.baselinePlanHash.trim().length === 0
  ) {
    return none("missing_baseline_hash");
  }

  const zest = buildReviseZest(ctx.originalGoal, ctx.revisionText);
  if (zest === null) return none("invalid_revise_zest");

  const runtime =
    deps.modelRuntime !== undefined && deps.modelRuntime !== null
      ? deps.modelRuntime
      : proposerRuntimeLabel();

  const adapter = new BlockedReviseAdapter(
    {
      refuseCode: ctx.refuseCode,
      ...(ctx.structuralFacts !== undefined ? { structuralFacts: ctx.structuralFacts } : {}),
      ...(ctx.planSummary !== undefined ? { planSummary: ctx.planSummary } : {}),
    },
    callModel,
    runtime,
  );

  return generateCandidatePlan(adapter, {
    workItemId: ctx.workItemId.trim(),
    ratifiedText: zest,
    ratifiedTextSha256: sha256(zest),
    baselinePlanHash: ctx.baselinePlanHash.trim(),
    memoryPointId: ctx.memoryPointId ?? null,
  });
}
