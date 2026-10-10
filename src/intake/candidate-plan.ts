/**
 * Candidate plan — AI_SEAMS_V1 seam 2 (L2.S3).
 *
 * From a CONFIRMED intent the deterministic parser cannot turn into a plan on
 * its own, this module asks a bounded Haiku-class model to propose a candidate
 * multi-step plan. The proposal is "not truth yet": every step is re-validated
 * through the frozen deterministic parser, and only the human-ratified plan
 * ever reaches an executor (the governed-decision kernel certifies
 * `ranWhatWasApproved` structurally).
 *
 * ── Contract (docs/ai-seams-v1-contract.md) ──────────────────────────────────
 *
 *   INV-AI-1  Callers consult this ONLY after the deterministic parser could
 *             not produce an executable understanding. This module never runs
 *             first, and parseable goals never touch a model.
 *
 *   INV-AI-2  The returned plan is a candidate. It is presented to a human as
 *             SYSTEM SUGGESTS-class content; ratification of the stamped draft
 *             that carries it is the only promotion path.
 *
 *   INV-AI-3  Fail-closed: no API key, API failure, malformed JSON, schema
 *             violation, empty/oversized plan, or ANY step that fails
 *             deterministic re-validation → null. The caller must treat null
 *             as "behave exactly as before this seam existed."
 *
 *   INV-AI-5  Haiku-class model, bounded max_tokens, one attempt only.
 *
 *   INV-AI-6  Execution never widens: proposed steps are restricted to the
 *             kernel's NON-DESTRUCTIVE executable subset (create_dir /
 *             create_file) and each step's canonical phrase must re-parse
 *             through `normalizeIntent` to the identical operation. The ops
 *             that eventually execute are deterministic re-parse products of
 *             the approved phrases — never raw model output.
 */

import { createProposerModelCall } from "../ai-seams/proposer-model-call.js";
import { extractJsonText } from "./llm-classifier.js";
import {
  normalizeIntent,
  describeIntent,
} from "../understand/interpretation/intent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CandidatePlanStep = {
  /** Canonical deterministic phrase — `mkdir <path>` or `touch <path>`. */
  readonly phrase: string;
  /** Human-readable description derived from the deterministic re-parse. */
  readonly summary: string;
};

export type CandidatePlanProposal = {
  readonly steps: readonly CandidatePlanStep[];
  /** The verbatim confirmed goal the plan was derived from. */
  readonly originalGoal: string;
};

/** Injectable model call for tests; production uses the Anthropic default. */
export type PlanModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

// ─── Bounds ───────────────────────────────────────────────────────────────────

export const MAX_CANDIDATE_PLAN_STEPS = 5;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a plan proposer for UseSteady, a governed file-operation tool.

## Your job
Decompose the user's confirmed goal into 1-${MAX_CANDIDATE_PLAN_STEPS} concrete filesystem steps.
Return ONLY a valid JSON object. No prose, no markdown, no explanation.

## Allowed operations (the ONLY two — never propose anything else)
- create_dir  — create a directory
- create_file — create an empty file

## HARD RULES
- Paths must be RELATIVE (no leading slash, no drive letter, no "..").
- Paths must come from the goal or be the obvious minimal structure for it.
  Never invent unrelated files.
- If the goal requires renaming, deleting, editing, or running anything,
  you cannot plan it: return {"steps": []}.
- Never exceed ${MAX_CANDIDATE_PLAN_STEPS} steps.

## JSON output schema
{"steps": [{"op": "create_dir" | "create_file", "path": "<relative path>"}]}

Return ONLY valid JSON.`;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Conservative lexical path hygiene for model-proposed paths. The sandboxed
 * executor still enforces real containment — this simply rejects shapes a
 * proposal has no business containing (absolute, traversal, spaces, escapes).
 */
export function isSafeRelativePlanPath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  if (!/^[A-Za-z0-9_\-./]+$/.test(path)) return false;
  if (path.startsWith("/") || path.startsWith(".")) return false;
  const segments = path.split("/");
  return segments.every(s => s.length > 0 && s !== ".." && s !== ".");
}

type RawStep = { readonly op?: unknown; readonly path?: unknown };

/**
 * Validate one raw model step into a canonical, deterministically re-parsed
 * plan step, or null when anything is off. The returned phrase/summary are
 * derived from the RE-PARSE, not from the model text (INV-AI-6).
 */
function validateStep(raw: RawStep): CandidatePlanStep | null {
  const op = raw.op;
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (op !== "create_dir" && op !== "create_file") return null;
  if (!isSafeRelativePlanPath(path)) return null;

  // Canonical phrase in the frozen grammar (CLI-native forms are exact).
  const phrase = op === "create_dir" ? `mkdir ${path}` : `touch ${path}`;

  // INV-AI-6 gate: the phrase must land inside the frozen deterministic parser
  // and reproduce exactly the proposed operation.
  const parsed = normalizeIntent(phrase);
  if (parsed === null || parsed.kind !== op) return null;
  if (parsed.path !== path) return null;

  return { phrase, summary: describeIntent(parsed) };
}

// ─── Default model call (Moonshot/Kimi default / Anthropic R6 — INV-AI-5) ────────────

const defaultPlanCall = createProposerModelCall({ maxTokens: 768 });

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Propose a candidate plan for a confirmed goal the deterministic parser could
 * not plan by itself. Returns null on every failure path (INV-AI-3) — the
 * caller falls back to today's deterministic behavior (needs-input elicitation
 * / the deterministic template baseline, INV-AI-7).
 */
export async function proposeCandidatePlan(
  goal: string,
  callModel: PlanModelCall = defaultPlanCall,
): Promise<CandidatePlanProposal | null> {
  let text: string | null;
  try {
    text = await callModel(SYSTEM_PROMPT, goal);
  } catch {
    return null;
  }
  if (text === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonText(text));
  } catch {
    return null;
  }

  if (raw === null || typeof raw !== "object") return null;
  const stepsRaw = (raw as { steps?: unknown }).steps;
  if (!Array.isArray(stepsRaw)) return null;
  if (stepsRaw.length === 0 || stepsRaw.length > MAX_CANDIDATE_PLAN_STEPS) {
    return null;
  }

  // Fail-full, fail-closed: ONE invalid step rejects the whole plan. Silently
  // dropping a step would execute a different plan than the model proposed and
  // the human believes they reviewed.
  const steps: CandidatePlanStep[] = [];
  for (const s of stepsRaw) {
    const step = validateStep(s as RawStep);
    if (step === null) return null;
    steps.push(step);
  }

  return { steps, originalGoal: goal };
}
