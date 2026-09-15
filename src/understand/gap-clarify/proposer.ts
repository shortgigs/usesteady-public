/**
 * Gap-clarify proposer — model suggestions when the operator picks No or Unsure
 * on an open reflection gap (IUR-19). Zero authority: suggestions only.
 */

import { createProposerModelCall } from "../../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../../intake/llm-classifier.js";
import {
  parseUnderstandingModelContextWire,
  renderUnderstandingModelContextPrompt,
  type UnderstandingModelContextWireV1,
} from "./model-context.js";

export const MAX_CLARIFY_INPUT_LENGTH = 8_000;
export const MAX_SUGGESTIONS = 4;
export const MAX_SUGGESTION_LENGTH = 220;

export type GapClarifySignal = "no" | "unsure";

export type GapClarifyModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

const SHARED_RULES = `Return ONLY valid JSON. No prose, no markdown.
Schema: {"suggestions": ["<short suggestion>", ...]}
Suggest up to ${MAX_SUGGESTIONS} SHORT items. NEVER pick an answer for the operator.
NEVER add product scope they did not mention in the context wire.`;

const SYSTEM_PROMPT_NO = `You are UseSteady's gap-clarify assistant.

The operator tapped **No** on the active gap question. That means the question
as framed does NOT fit — they are rejecting the premise or the default "yes"
reading, NOT committing to the opposite yet.

${SHARED_RULES}

For **No**: reframe the question, offer narrower scopes, spell out what Yes vs
No would mean for THEIR held request, or suggest a different way to ask the gap.`;

const SYSTEM_PROMPT_UNSURE = `You are UseSteady's gap-clarify assistant.

The operator tapped **Unsure** on the active gap question. They have not
rejected the question — they need help deciding.

${SHARED_RULES}

For **Unsure**: explain tradeoffs in plain language, give 2–3 concrete examples
grounded in THEIR held request, and clarify what answering Yes would commit to.`;

export type GapClarifyOutcome =
  | { readonly kind: "candidate"; readonly suggestions: readonly string[] }
  | { readonly kind: "unavailable" };

const defaultGapClarifyCall = createProposerModelCall({ maxTokens: 512 });

function systemPromptForSignal(signal: GapClarifySignal): string {
  return signal === "no" ? SYSTEM_PROMPT_NO : SYSTEM_PROMPT_UNSURE;
}

export async function proposeGapClarifyOutcome(
  args: {
    readonly context?: unknown;
    /** Legacy flat fields — used only when context wire is absent. */
    readonly held?: string;
    readonly question?: string;
    readonly signal?: GapClarifySignal;
    readonly heard?: readonly string[];
    readonly shown?: string;
  },
  callModel: GapClarifyModelCall = defaultGapClarifyCall,
): Promise<GapClarifyOutcome> {
  const UNAVAILABLE = { kind: "unavailable" } as const;

  let wire: UnderstandingModelContextWireV1 | null = parseUnderstandingModelContextWire(
    args.context,
  );

  if (!wire) {
    const held = (args.held ?? "").trim();
    const question = (args.question ?? "").trim();
    const signal = args.signal;
    if (
      !held ||
      !question ||
      (signal !== "no" && signal !== "unsure") ||
      held.length > MAX_CLARIFY_INPUT_LENGTH
    ) {
      return UNAVAILABLE;
    }
    wire = {
      format: "usesteady.understanding-model-context.v1",
      purpose: "gap_clarify",
      heldRequest: held,
      conversationLedger: (args.heard ?? []).map((text) => ({
        text: text.trim(),
        included: true,
      })),
      inferredDraft: null,
      openQuestions: [question],
      activeGapQuestion: question,
      priorGapClarifications: [],
      gapAnswerSignal: signal,
      memoryScanScope: "none",
      workflowMemoryLedger: [],
    };
  }

  if (wire.heldRequest.length > MAX_CLARIFY_INPUT_LENGTH) {
    return UNAVAILABLE;
  }

  // gap_clarify wires always carry a signal (parse + fallback both guarantee it),
  // but the wire type permits null for draft_intent. Fail closed rather than
  // guess a prompt.
  const signal = wire.gapAnswerSignal;
  if (signal !== "no" && signal !== "unsure") return UNAVAILABLE;

  const userPrompt = renderUnderstandingModelContextPrompt(wire);

  let text: string | null;
  try {
    text = await callModel(systemPromptForSignal(signal), userPrompt);
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
  const listRaw = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(listRaw)) return UNAVAILABLE;

  const suggestions: string[] = [];
  for (const item of listRaw) {
    if (typeof item !== "string") return UNAVAILABLE;
    const t = item.trim();
    if (t.length === 0 || t.length > MAX_SUGGESTION_LENGTH) return UNAVAILABLE;
    suggestions.push(t);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }

  if (suggestions.length === 0) return UNAVAILABLE;
  return { kind: "candidate", suggestions };
}
