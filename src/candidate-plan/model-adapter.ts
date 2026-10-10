/**
 * ModelCandidatePlanAdapter — CP.S2 (USESTEADY_CANDIDATE_PLAN_CONTRACT_V2).
 *
 * Sixth proposer seam, same discipline as the intent-draft proposer
 * (docs/ai-seams-v1-contract.md, INV-AI-1..7): bounded Haiku-class call,
 * injectable for tests, fail-closed on every path. The adapter DRAFTS raw
 * tasks only — every accept/drop decision (anti-echo, forbidden classes,
 * span validity) belongs to the gate, which never trusts this output.
 *
 * Models are replaceable runtime components (frozen architecture): the
 * runtime label is metadata inside the work item record, never authorship.
 */

import {
  createProposerModelCall,
  proposerRuntimeLabel,
} from "../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../intake/llm-classifier.js";
import type { CandidatePlanAdapter } from "./adapter.js";
import type { RawCandidateTask } from "./types.js";
import { CANDIDATE_EXECUTOR_CLASSES } from "./types.js";

// ─── Bounds (INV-AI-5) ────────────────────────────────────────────────────────

/** Ratified goals longer than this never touch a model. */
export const MAX_PLAN_INPUT_LENGTH = 8_000;

/** Maximum number of drafted tasks kept. */
export const MAX_PLAN_TASKS = 8;

/** Maximum length of any single task field. */
export const MAX_TASK_FIELD_LENGTH = 400;

// ─── Injectable model call ────────────────────────────────────────────────────

export type CandidatePlanModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * Exported for characterization tests (CP REV_1 executable-intent steer).
 * Adapters still draft only; the gate never trusts this text as authority.
 */
export const CANDIDATE_PLAN_SYSTEM_PROMPT = `You are a work-decomposition assistant for UseSteady, a governed work tool.

You receive ONE ratified goal — the exact text a human agreed to. Draft the
first concrete work tasks that decompose it. A human reviews every task; your
output is a candidate, never a decision. Return ONLY a valid JSON object.

UseSteady executes approved work. Your job is to propose EXECUTABLE intent
the human can approve and Core can run — not planning theater
(clarify / define / sequence / confirm meta-steps) and not "write a strategy
document" unless the goal explicitly asks for a written plan, research, or doc.

## HARD RULES
- 3 to ${MAX_PLAN_TASKS} tasks, in a sensible order.
- Each deliverable is a CONCRETE named artifact. NEVER restate the goal text
  as a deliverable.
- Build / create / implement / ship / scaffold goals (CHANGE_REALITY): prefer
  executor_class "repo_change" with a MINIMAL relative scaffold the goal
  implies (directories and starter files). Put the relative path IN the
  deliverable text (e.g. "src/app/", "README.md"). Paths may be derived as
  obvious minimal structure when the goal names none (CP REV_1). Do NOT invent
  vendors, budgets, dates, team names, or technologies absent from the goal.
- Document / research / plan / blueprint goals: prefer executor_class
  "document" with named written artifacts. Do not invent file paths.
- Third-party platforms named in the goal (Shopify, Stripe admin, AWS console,
  etc.): UseSteady CANNOT operate those systems. NEVER return a plan whose
  every task is executor_class "external". Prefer a Core-executable mix:
  "document" (named setup checklist / runbook), and/or "repo_change" (local
  stub app or notes scaffold with relative paths), and/or "human" (operator
  performs the outside act and attests). You may mention the platform in
  deliverable text when the goal names it; do not pretend Core will log into
  it. Reserve "external" only as a minority companion task beside at least one
  routable class (human|document|repo_change) — never as the sole class.
- Never invent product facts beyond a minimal scaffold. If the goal is vague,
  keep scaffold names generic and short.
- action: one lowercase verb (e.g. create, add, draft, list, decide).
  Never use: hire, assign, schedule, estimate, track, monitor, maintain,
  dashboard, database, deploy.
- executor_class: one of "repo_change" | "document" | "cli" | "human" |
  "external" — your best proposal for who/what would produce the deliverable.
- verification_cue: what observable evidence would confirm the task really
  happened (a path that exists, an artifact that exists, a record that names
  something).
- rationale: one sentence — why this task follows from the goal.
- source_span: OPTIONAL {"start": n, "end": n} character offsets into the
  exact goal text that this task is anchored to. Include it ONLY when the
  task derives from a specific phrase; omit it otherwise.

## JSON output schema
{"tasks": [{"action": "...", "deliverable": "...", "outcome": "...",
"executor_class": "...", "verification_cue": "...", "rationale": "...",
"source_span": {"start": 0, "end": 10}}, ...]}

Return ONLY valid JSON.`;

const SYSTEM_PROMPT = CANDIDATE_PLAN_SYSTEM_PROMPT;

// ─── Default model call (Moonshot/Kimi default / Anthropic R6 — INV-AI-5) ────────────

const defaultCandidatePlanCall = createProposerModelCall({ maxTokens: 2048 });

// ─── Adapter ──────────────────────────────────────────────────────────────────

function coerceField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_FIELD_LENGTH) {
    return null;
  }
  return trimmed;
}

/** Parse one raw task object; null = shape unusable (dropped here — the
 *  gate then judges the survivors). */
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

  let sourceSpan: { start: number; end: number } | undefined;
  const spanRaw = v["source_span"];
  if (spanRaw !== undefined && spanRaw !== null) {
    if (typeof spanRaw !== "object") return null;
    const s = (spanRaw as Record<string, unknown>)["start"];
    const e = (spanRaw as Record<string, unknown>)["end"];
    if (typeof s !== "number" || typeof e !== "number") return null;
    sourceSpan = { start: s, end: e };
  }

  return {
    action,
    deliverable,
    outcome,
    executorClass,
    verificationCue,
    rationale,
    ...(sourceSpan ? { sourceSpan } : {}),
  };
}

export class ModelCandidatePlanAdapter implements CandidatePlanAdapter {
  readonly runtime: string;
  private readonly callModel: CandidatePlanModelCall;

  constructor(
    callModel: CandidatePlanModelCall = defaultCandidatePlanCall,
    runtime: string = proposerRuntimeLabel(),
  ) {
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

    const text = await this.callModel(SYSTEM_PROMPT, trimmed);
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
      if (tasks.length === MAX_PLAN_TASKS) break;
    }
    return tasks;
  }
}
