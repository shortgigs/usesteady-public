/**
 * Intent-draft proposer — the candidate-synthesis seam (fifth proposer seam).
 *
 * Charter:  USESTEADY_INTENT_UNDER_REFLECTION_V1_REV_5 (IUR-10..IUR-11), in
 *           shortgigs/usesteady-ops docs/product/.
 * Contract: docs/ai-seams-v1-contract.md (INV-AI-1..7).
 *
 * Production evidence that motivated this seam (2026-07-05 operator session):
 * the reflection surface ECHOED the operator's words back and asked taxonomy
 * questions — "Need what your inferrence can help my intent -- not saying my
 * intent back to me". This proposer is the synthesis: it asks a bounded
 * Haiku-class model to DRAFT the held request as a clean, self-contained
 * statement, plus up to three genuinely open questions.
 *
 * Governance (explicit — this seam crosses a line the turn-reading seam did
 * not): the draft is model-authored TEXT that reaches primary UI. It is
 * constitutional because the portal renders it verbatim under an explicit
 * model-provenance label, the human edits freely, and ONLY an explicit human
 * accept promotes it into the held request — at which point ratification
 * anchors to the visible accepted text (IUR-11, the WF-A1 principle). The
 * proposer itself carries zero authority and its absence is invisible.
 *
 * Fail-closed on every path (INV-AI-3): no key, API error, malformed JSON,
 * over-bounds, empty draft → "unavailable". The caller must treat
 * "unavailable" exactly as if this seam did not exist.
 */

import { createProposerModelCall } from "../../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../../intake/llm-classifier.js";

// ─── Bounds (INV-AI-5) ────────────────────────────────────────────────────────

/** Held requests longer than this never touch a model. */
export const MAX_DRAFT_INPUT_LENGTH = 8_000;

/** Maximum length of the drafted statement. */
export const MAX_DRAFT_LENGTH = 500;

/** Maximum number of open questions. */
export const MAX_OPEN_QUESTIONS = 3;

/** Maximum length of one open question. */
export const MAX_OPEN_QUESTION_LENGTH = 200;

// ─── Injectable model call ────────────────────────────────────────────────────

/** Injectable model call for tests; production uses the Anthropic default. */
export type IntentDraftModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an intent-drafting assistant for UseSteady, a governed work tool.

The user has been describing what they want to get done, possibly across
several messy messages (often multiple lines). Later lines are frequently
short answers to your open questions — platform names ("Instagram", "TikTok"),
markets, or one-word scope picks. Your job is to DRAFT their request as they
would state it if they wrote it cleanly — so they can edit it and adopt it.
Return ONLY a valid JSON object. No prose, no markdown, no explanation.

## HARD RULES
- Write in the user's voice ("Build...", "Fix...", "Explain..."), plain
  language, one to three sentences.
- Preserve their meaning exactly. NEVER add scope, features, targets, or
  constraints they did not ask for. NEVER remove something they asked for.
- When the input has multiple lines, fold EVERY line into one coherent draft.
  Short later lines are answers — weave them in (e.g. platform names belong
  in the marketplace/creator scope sentence). Never drop a line.
- Answers like "all of them", "all", "all platforms", or "yes, all" to a
  platform-scope question mean every platform you listed — weave that breadth
  into the draft and do NOT repeat that question in open_questions.
- If a later line answers an open question, remove that question from
  open_questions and reflect the answer in the draft.
- If their words are vague, the draft stays honestly vague — do not invent
  specifics to sound confident.
- open_questions: up to ${MAX_OPEN_QUESTIONS} SHORT questions that are genuinely
  undecided and would change what gets built. Only questions the user can
  answer. Empty array if nothing is genuinely open.
- The draft is a candidate a human will review — never claim it is final.

## JSON output schema
{"draft": "<the request, cleanly stated>", "open_questions": ["<question>", ...]}

Return ONLY valid JSON.`;

// ─── Default model call (Moonshot/Kimi default / Anthropic R6 — INV-AI-5) ────────────

const defaultIntentDraftCall = createProposerModelCall({ maxTokens: 512 });

// ─── Public API ───────────────────────────────────────────────────────────────

export type IntentDraft = {
  /** The request, cleanly stated — a candidate the human edits and accepts. */
  readonly draft: string;
  /** Up to three genuinely open questions; may be empty. */
  readonly openQuestions: readonly string[];
};

export type IntentDraftOutcome =
  | { readonly kind: "candidate"; readonly intentDraft: IntentDraft }
  | { readonly kind: "unavailable" };

/**
 * Propose a drafted statement of the held request. Fail-closed: every failure
 * path returns "unavailable" and the caller behaves exactly as before this
 * seam existed (the removal invariant, IUR-10).
 */
export async function proposeIntentDraftOutcome(
  args: string | { readonly context?: unknown; readonly held?: string },
  callModel: IntentDraftModelCall = defaultIntentDraftCall,
): Promise<IntentDraftOutcome> {
  const UNAVAILABLE = { kind: "unavailable" } as const;

  let userPrompt: string;
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_DRAFT_INPUT_LENGTH) {
      return UNAVAILABLE;
    }
    userPrompt = trimmed;
  } else {
    const { parseUnderstandingModelContextWire, renderUnderstandingModelContextPrompt } =
      await import("../gap-clarify/model-context.js");
    const wire = parseUnderstandingModelContextWire(args.context);
    if (wire && wire.purpose === "draft_intent") {
      if (wire.heldRequest.length > MAX_DRAFT_INPUT_LENGTH) return UNAVAILABLE;
      userPrompt = renderUnderstandingModelContextPrompt(wire);
    } else {
      const held = (args.held ?? "").trim();
      if (held.length === 0 || held.length > MAX_DRAFT_INPUT_LENGTH) {
        return UNAVAILABLE;
      }
      userPrompt = held;
    }
  }

  let text: string | null;
  try {
    text = await callModel(SYSTEM_PROMPT, userPrompt);
  } catch {
    return UNAVAILABLE;
  }
  if (text === null) return UNAVAILABLE;

  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonText(text));
  } catch {
    return UNAVAILABLE;
  }

  if (raw === null || typeof raw !== "object") return UNAVAILABLE;
  const draft = (raw as { draft?: unknown }).draft;
  if (typeof draft !== "string") return UNAVAILABLE;
  const draftTrimmed = draft.trim();
  if (draftTrimmed.length === 0 || draftTrimmed.length > MAX_DRAFT_LENGTH) {
    return UNAVAILABLE;
  }

  const questionsRaw = (raw as { open_questions?: unknown }).open_questions;
  const openQuestions: string[] = [];
  if (questionsRaw !== undefined) {
    if (!Array.isArray(questionsRaw)) return UNAVAILABLE;
    for (const q of questionsRaw) {
      if (typeof q !== "string") return UNAVAILABLE;
      const qt = q.trim();
      if (qt.length === 0 || qt.length > MAX_OPEN_QUESTION_LENGTH) return UNAVAILABLE;
      openQuestions.push(qt);
      if (openQuestions.length === MAX_OPEN_QUESTIONS) break;
    }
  }

  return {
    kind: "candidate",
    intentDraft: { draft: draftTrimmed, openQuestions },
  };
}
