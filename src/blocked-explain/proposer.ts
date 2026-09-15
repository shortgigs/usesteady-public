/**
 * Blocked-explain proposer — Seam 2 extension (AI_SEAMS_V1_REV_1).
 *
 * Wall-only: explains why Start/handoff refused and suggests bounded options.
 * Prefer Direct xAI / Grok via createProposerModelCall (org transport honored).
 * Fail-closed to static HUL (INV-BER-7). Never executes; never CERT.
 */

import {
  createProposerModelCall,
  proposerRuntimeLabel,
  type ProposerModelCall,
} from "../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../intake/llm-classifier.js";
import { staticBlockedExplain } from "./static-hul.js";
import {
  BLOCKED_EXPLAIN_FORMAT,
  BLOCKED_EXPLAIN_OPTIONS,
  isBlockedExplainOption,
  isBlockedExplainReasonKey,
  isBlockedExplainRefuseCode,
  type BlockedExplainContext,
  type BlockedExplainOption,
  type BlockedExplainPayload,
} from "./types.js";

export const MAX_REASON_HUL_LENGTH = 900;
export const MAX_STRUCTURAL_FACTS = 12;
export const MAX_FACT_LENGTH = 240;
export const MAX_PLAN_SUMMARY_LENGTH = 600;

export type BlockedExplainModelCall = ProposerModelCall;

const SYSTEM_PROMPT = `You are UseSteady's blocked-explain assistant (governance lane).

The operator hit a Start / handoff refuse wall. Explain WHY in plain language and
suggest bounded NEXT OPTIONS only. You have ZERO authority.

Return ONLY valid JSON. No markdown. No prose outside JSON.
Schema:
{
  "reasonKey": "<one of: external_only_plan|not_routable_plan|over_cap_plan|handoff_not_derivable|approved_hash_stale|content_pin_refuse>",
  "reasonHul": "<plain language for a non-engineer operator, <= ${MAX_REASON_HUL_LENGTH} chars>",
  "options": ["<subset of: export_approved_plan|change_the_plan|start_new_work_item|abandon|retry_handoff>"]
}

HARD RULES:
- NEVER invent filesystem/code ops as WILL. NEVER claim you will run Shopify or any store.
- NEVER assign CERT, confidence scores, or reconstructability.
- NEVER say the plan will auto-execute or that approval can be skipped.
- Prefer honest structural facts from the user message over guessing.
- Options must be from the closed enum only. Include change_the_plan when revision could help.
- Keep reasonHul calm, specific, and free of jargon codes when possible.`;

const defaultCall = createProposerModelCall({ maxTokens: 768 });

function clampFacts(
  facts: readonly string[] | undefined,
): readonly string[] {
  if (!facts) return [];
  const out: string[] = [];
  for (const f of facts) {
    if (typeof f !== "string") continue;
    const t = f.trim();
    if (!t) continue;
    out.push(t.slice(0, MAX_FACT_LENGTH));
    if (out.length >= MAX_STRUCTURAL_FACTS) break;
  }
  return out;
}

function buildUserPrompt(ctx: BlockedExplainContext): string {
  const facts = clampFacts(ctx.structuralFacts);
  const summary =
    typeof ctx.planSummary === "string"
      ? ctx.planSummary.trim().slice(0, MAX_PLAN_SUMMARY_LENGTH)
      : "";
  const lines = [
    `refuseCode: ${ctx.refuseCode}`,
    summary ? `planSummary: ${summary}` : null,
    facts.length > 0 ? `structuralFacts:` : null,
    ...facts.map((f) => `- ${f}`),
  ].filter((x): x is string => x !== null);
  return lines.join("\n");
}

function parseModelPayload(
  text: string,
  refuseCode: BlockedExplainContext["refuseCode"],
  modelRuntime: string | null,
): BlockedExplainPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonText(text));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as {
    reasonKey?: unknown;
    reasonHul?: unknown;
    options?: unknown;
  };

  if (!isBlockedExplainReasonKey(obj.reasonKey)) return null;
  if (typeof obj.reasonHul !== "string") return null;
  const reasonHul = obj.reasonHul.trim();
  if (reasonHul.length === 0 || reasonHul.length > MAX_REASON_HUL_LENGTH) {
    return null;
  }
  // Strip authority-shaped language that would violate INV-BER-2 / fake CERT.
  const lower = reasonHul.toLowerCase();
  if (
    lower.includes("system will") ||
    lower.includes("certifiedconfidence") ||
    lower.includes("auto-start") ||
    lower.includes("i will execute") ||
    lower.includes("running the ops now")
  ) {
    return null;
  }

  if (!Array.isArray(obj.options) || obj.options.length === 0) return null;
  const options: BlockedExplainOption[] = [];
  for (const item of obj.options) {
    if (!isBlockedExplainOption(item)) return null;
    if (!options.includes(item)) options.push(item);
  }
  if (options.length === 0) return null;
  // Cap to known enum size.
  if (options.length > BLOCKED_EXPLAIN_OPTIONS.length) return null;

  return {
    format: BLOCKED_EXPLAIN_FORMAT,
    isCandidate: true,
    refuseCode,
    reasonKey: obj.reasonKey,
    reasonHul,
    options,
    modelRuntime,
    fromStaticTemplate: false,
  };
}

/**
 * Propose blocked-explain at a refuse wall.
 * Always returns a payload — model enrichment or static HUL (never silent).
 */
export async function proposeBlockedExplain(
  ctx: BlockedExplainContext,
  callModel: BlockedExplainModelCall = defaultCall,
  deps: { readonly modelRuntime?: string | null } = {},
): Promise<BlockedExplainPayload> {
  const fallback = staticBlockedExplain(ctx.refuseCode);
  if (!isBlockedExplainRefuseCode(ctx.refuseCode)) {
    return fallback;
  }

  let text: string | null;
  try {
    text = await callModel(SYSTEM_PROMPT, buildUserPrompt(ctx));
  } catch {
    return fallback;
  }
  if (text === null) return fallback;

  const runtime =
    deps.modelRuntime !== undefined
      ? deps.modelRuntime
      : proposerRuntimeLabel();

  const parsed = parseModelPayload(text, ctx.refuseCode, runtime);
  return parsed ?? fallback;
}
