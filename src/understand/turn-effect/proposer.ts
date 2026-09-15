/**
 * Turn-reading proposer — the conversational-turn seam (fourth proposer seam).
 *
 * Charter:  USESTEADY_INTENT_UNDER_REFLECTION_V1_REV_3 (IUR-9), in
 *           shortgigs/usesteady-ops docs/product/.
 * Contract: docs/ai-seams-v1-contract.md (INV-AI-1..7) — mirrors the
 *           goal-isolation proposer discipline (src/understand/goal-isolation/).
 *
 * The portal's understanding surface keeps a visible held request and reads
 * each new conversational turn deterministically first (lane verbs, surface
 * vocabulary, certified control-move recognition). Only when EVERY
 * deterministic reader declines is this proposer consulted: it asks a bounded
 * Haiku-class model to CLASSIFY the one unreadable turn into a closed
 * category set. The category is a candidate reading, never a decision.
 *
 * Engraved design rule (IUR-9): the model classifies; it never speaks. Reply
 * copy for each category is a deterministic template on the portal side,
 * living under the same HUL / RC test gates as all other surface copy. This
 * proposer returns a category token and nothing else.
 *
 * Fail-closed on every path (INV-AI-3): no key, API error, malformed JSON,
 * unknown category, over-bounds → "unavailable". The caller must treat
 * "unavailable" exactly as if this seam did not exist.
 */

import { createProposerModelCall } from "../../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../../intake/llm-classifier.js";

// ─── Closed category set (IUR-9) ─────────────────────────────────────────────

export const TURN_READING_CATEGORIES = [
  "request_content",
  "meta_conversation",
  "process_question",
  "suggestion_question",
  "cannot_tell",
] as const;

export type TurnReadingCategory = (typeof TURN_READING_CATEGORIES)[number];

// ─── Bounds (INV-AI-5) ────────────────────────────────────────────────────────

/** Turns longer than this never touch a model (cost + prompt-injection bound). */
export const MAX_TURN_LENGTH = 2_000;

/** Held-request context is truncated to this length in the model call. */
export const MAX_HELD_CONTEXT_LENGTH = 4_000;

/**
 * Shown-surface context (IUR-14, REV_6) is truncated to this length. This is
 * system-authored display text (the drafted candidate, its open questions,
 * the current reflection question) -- never an operator trail.
 */
export const MAX_SHOWN_CONTEXT_LENGTH = 4_000;

// ─── Injectable model call ────────────────────────────────────────────────────

/** Injectable model call for tests; production uses the Anthropic default. */
export type TurnReadingModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a turn-reading classifier for UseSteady, a governed work tool.

The user has a REQUEST held on file, and has just sent a NEW MESSAGE in a
conversation about that request. Your only job is to classify the NEW MESSAGE.
Return ONLY a valid JSON object. No prose, no markdown, no explanation.

## Categories (the ONLY five)
- request_content     — the message adds to, narrows, or changes WHAT the user
                        wants done (more scope, more detail, a different target)
- meta_conversation   — the message is about the conversation itself or about the
                        system's reading of the request (complaints, "you are not
                        understanding me", commentary on the tool's behavior) —
                        not about the work to be done
- process_question    — the message asks how this tool or process works, or what
                        happens next ("then what?", "who approves this?")
- suggestion_question — the message asks about, questions, or responds to one of
                        the system's OWN suggestions or questions (shown below as
                        WHAT THE TOOL IS SHOWING), e.g. "why did you suggest X?",
                        "what made the model ask about Y?" — rather than adding
                        scope of its own
- cannot_tell         — you are not confident in any of the above

## Rules
- Classify the NEW MESSAGE only. The held request is context; never classify it.
- WHAT THE TOOL IS SHOWING is text the tool itself displayed to the user. If the
  NEW MESSAGE quotes or paraphrases that shown text while asking about it, that
  is suggestion_question — the quoted words are the tool's, not new scope.
- A message that only asks WHY something is the way it is ("why X?", "why not
  Y?") is asking for a rationale. Rationale-seeking states no scope of its own:
  it is suggestion_question when the choice or assumption being questioned
  appears in WHAT THE TOOL IS SHOWING or in the held request, and
  meta_conversation otherwise. It is never request_content — "make it Y
  instead" adds scope; "why not Y?" questions an assumption.
- The classification changes nothing by itself — a human reviews every reading.
- When in doubt, return cannot_tell. Never guess.

## Output schema
{"category": "request_content" | "meta_conversation" | "process_question" | "suggestion_question" | "cannot_tell"}

Return ONLY valid JSON.`;

// ─── Default model call (Moonshot/Kimi default / Anthropic R6 — INV-AI-5) ────────────

const defaultTurnReadingCall = createProposerModelCall({ maxTokens: 64 });

// ─── Public API ───────────────────────────────────────────────────────────────

export type TurnReadingOutcome =
  | { readonly kind: "candidate"; readonly category: TurnReadingCategory }
  | { readonly kind: "unavailable" };

/**
 * Propose a reading of one conversational turn against the current held
 * request. Returns a closed-set category as a candidate, or "unavailable" on
 * every failure path — the caller then behaves exactly as before this seam
 * existed (the removal invariant).
 */
export async function proposeTurnReadingOutcome(
  args: {
    readonly held: string;
    readonly turn: string;
    /**
     * IUR-14 (REV_6): what the surface is currently showing -- system-authored
     * display text (drafted candidate, open questions, reflection question).
     * Without it the model cannot recognize its own words quoted back.
     * Optional; absent keeps the REV_3 wire exactly.
     */
    readonly shown?: string;
  },
  callModel: TurnReadingModelCall = defaultTurnReadingCall,
): Promise<TurnReadingOutcome> {
  const UNAVAILABLE = { kind: "unavailable" } as const;

  const turn = args.turn.trim();
  if (turn.length === 0 || turn.length > MAX_TURN_LENGTH) return UNAVAILABLE;
  const held = args.held.trim().slice(0, MAX_HELD_CONTEXT_LENGTH);
  const shown = (args.shown ?? "").trim().slice(0, MAX_SHOWN_CONTEXT_LENGTH);

  const user =
    `REQUEST HELD ON FILE:\n${held.length > 0 ? held : "(empty)"}\n\n` +
    (shown.length > 0 ? `WHAT THE TOOL IS SHOWING:\n${shown}\n\n` : "") +
    `NEW MESSAGE:\n${turn}`;

  let text: string | null;
  try {
    text = await callModel(SYSTEM_PROMPT, user);
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
  const category = (raw as { category?: unknown }).category;
  if (
    typeof category !== "string" ||
    !(TURN_READING_CATEGORIES as readonly string[]).includes(category)
  ) {
    return UNAVAILABLE;
  }

  return { kind: "candidate", category: category as TurnReadingCategory };
}
