/**
 * Blocked-revise adapter — Seam 2 extension (AI_SEAMS_V1_REV_2 / BER S2).
 *
 * Re-enters the candidate-plan draft path with refuse-wall context + operator
 * revision. Drafts raw tasks only; the candidate-plan gate validates (CP-*).
 * Zero authority. Never executes. Never CERT.
 */

import {
  createProposerModelCall,
  proposerRuntimeLabel,
} from "../ai-seams/proposer-model-call.js";
import type { BlockedExplainRefuseCode } from "../blocked-explain/types.js";
import { extractJsonText } from "../intake/llm-classifier.js";
import type { CandidatePlanAdapter } from "../candidate-plan/adapter.js";
import type { CandidatePlanModelCall } from "../candidate-plan/model-adapter.js";
import {
  CANDIDATE_EXECUTOR_CLASSES,
  MAX_PLAN_INPUT_LENGTH,
  MAX_PLAN_TASKS,
  MAX_TASK_FIELD_LENGTH,
} from "../candidate-plan/index.js";
import type { RawCandidateTask } from "../candidate-plan/types.js";

export type BlockedReviseRefuseContext = {
  readonly refuseCode: BlockedExplainRefuseCode;
  readonly structuralFacts?: readonly string[];
  readonly planSummary?: string;
};

export const BLOCKED_REVISE_SYSTEM_PROMPT = `You are UseSteady's blocked-revise plan proposer (governance lane).

The operator hit a Start / handoff refuse wall and chose "Change the plan".
Draft a NEW candidate work decomposition that addresses the refuse and the
operator's revision. A human must re-approve every step before anything runs.
You have ZERO authority. Return ONLY valid JSON. No markdown. No prose outside JSON.

## HARD RULES
- 3 to ${MAX_PLAN_TASKS} tasks, in a sensible order.
- Each deliverable is a CONCRETE named artifact. NEVER restate the whole goal
  as a deliverable.
- Prefer Core-executable intent: executor_class "repo_change" (relative paths
  in deliverable), "document" (named written artifacts), and/or "human"
  (operator attests). NEVER return a plan whose every task is "external".
- Third-party platforms (Shopify, Stripe admin, etc.): UseSteady CANNOT operate
  them. Use document/human/repo_change companions; "external" only as a minority
  companion beside at least one routable class.
- NEVER invent filesystem/code ops as WILL. NEVER claim you will execute.
- NEVER assign CERT, confidence, or reconstructability.
- NEVER say the plan will auto-execute or that approval can be skipped.
- action: one lowercase verb. Never: hire, assign, schedule, estimate, track,
  monitor, maintain, dashboard, database, deploy.
- verification_cue: observable evidence later (path exists, artifact exists) —
  never Evidence verbs ("Verified by", "Reality agree").
- rationale: one sentence why this task follows from the goal + revision.

## JSON output schema
{"tasks": [{"action": "...", "deliverable": "...", "outcome": "...",
"executor_class": "repo_change"|"document"|"cli"|"human"|"external",
"verification_cue": "...", "rationale": "..."}, ...]}

Return ONLY valid JSON.`;

const defaultCall = createProposerModelCall({ maxTokens: 2048 });

function coerceField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_FIELD_LENGTH) {
    return null;
  }
  return trimmed;
}

function parseRawTask(value: unknown): RawCandidateTask | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const action = coerceField(v["action"]);
  const deliverable = coerceField(v["deliverable"]);
  const outcome = coerceField(v["outcome"]);
  const executorClass = coerceField(v["executor_class"]);
  const verificationCue = coerceField(v["verification_cue"]);
  const rationale = coerceField(v["rationale"]);
  if (
    !action ||
    !deliverable ||
    !outcome ||
    !executorClass ||
    !verificationCue ||
    !rationale
  ) {
    return null;
  }
  if (
    !(CANDIDATE_EXECUTOR_CLASSES as readonly string[]).includes(executorClass)
  ) {
    return null;
  }

  return {
    action,
    deliverable,
    outcome,
    executorClass,
    verificationCue,
    rationale,
  };
}

function buildUserPrompt(
  reviseZest: string,
  refuse: BlockedReviseRefuseContext,
): string {
  const facts = (refuse.structuralFacts ?? [])
    .filter((f) => typeof f === "string" && f.trim().length > 0)
    .slice(0, 12)
    .map((f) => `- ${f.trim().slice(0, 240)}`);
  const summary =
    typeof refuse.planSummary === "string"
      ? refuse.planSummary.trim().slice(0, 600)
      : "";
  const lines = [
    "REVISE ZEST (human-authored goal + revision — propose against this):",
    reviseZest,
    "",
    "REFUSE WALL (why Start failed — address in the new candidate; zero authority):",
    `refuseCode: ${refuse.refuseCode}`,
    summary ? `priorPlanSummary: ${summary}` : null,
    facts.length > 0 ? "structuralFacts:" : null,
    ...facts,
  ].filter((x): x is string => x !== null);
  return lines.join("\n");
}

/**
 * Candidate-plan adapter for blocked revise. Same gate as CP.S3; refuse
 * context is advisory prompt only and never authority.
 */
export class BlockedReviseAdapter implements CandidatePlanAdapter {
  readonly runtime: string;
  private readonly callModel: CandidatePlanModelCall;
  private readonly refuse: BlockedReviseRefuseContext;

  constructor(
    refuse: BlockedReviseRefuseContext,
    callModel: CandidatePlanModelCall = defaultCall,
    runtime: string = proposerRuntimeLabel(),
  ) {
    this.refuse = refuse;
    this.callModel = callModel;
    this.runtime = runtime;
  }

  async draftTasks(
    ratifiedText: string,
  ): Promise<readonly RawCandidateTask[]> {
    const trimmed = ratifiedText.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PLAN_INPUT_LENGTH) {
      return [];
    }

    let text: string | null;
    try {
      text = await this.callModel(
        BLOCKED_REVISE_SYSTEM_PROMPT,
        buildUserPrompt(trimmed, this.refuse),
      );
    } catch {
      return [];
    }
    if (text === null) return [];

    let raw: unknown;
    try {
      raw = JSON.parse(extractJsonText(text));
    } catch {
      return [];
    }
    if (raw === null || typeof raw !== "object") return [];
    const tasksRaw = (raw as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasksRaw)) return [];

    const tasks: RawCandidateTask[] = [];
    for (const entry of tasksRaw) {
      const parsed = parseRawTask(entry);
      if (parsed) tasks.push(parsed);
      if (tasks.length >= MAX_PLAN_TASKS) break;
    }
    return tasks;
  }
}
