/**
 * IsolatedIntent proposer — the goal-isolation seam (charter S1).
 *
 * Charter:  docs/product/USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1.md
 * Contract: docs/ai-seams-v1-contract.md (INV-AI-1..7) — third proposer seam,
 *           mirroring src/intake/candidate-plan.ts discipline.
 *
 * Asks a bounded Haiku-class model to partition ONE confirmed raw input into
 * exactly one GOAL span plus categorized non-goal spans. The proposal is a
 * candidate reading, never truth (INV-GI-6): callers surface it as a
 * rejectable inference; ratification is the only promotion.
 *
 * ── Structural re-validation (INV-GI-7) ──────────────────────────────────────
 *
 * The model must QUOTE the operator to propose a reading. Every returned span
 * is re-located in the original text left-to-right; the text skipped between
 * consecutive spans (and before the first / after the last) must be
 * whitespace only. This one walk enforces, without trusting the model:
 *
 *   - verbatim spans (anything invented or edited fails to locate)
 *   - document order (a reordered span fails to locate past the cursor)
 *   - total coverage / no-loss (a dropped meaningful chunk leaves a
 *     non-whitespace gap — report §7.2 guarantee 3)
 *   - honest offsets (start/end are OURS, computed from the locate, never
 *     copied from model output)
 *
 * Single-goal (§7.2 guarantee 1) is enforced by count at the ARTIFACT level:
 * an IsolatedIntent always carries exactly one goal. Since taxonomy slice 3
 * (USESTEADY_UNDERSTANDING_TURN_TYPE_TAXONOMY_V1, `compound` type), a
 * structurally valid proposal carrying 2+ GOAL spans is no longer discarded:
 * it becomes the honest `compound` outcome, listing the candidate goals so a
 * human can say which one is the request. Fail-closed on every other path
 * (INV-GI-3): no key, API error, malformed JSON, bad category, over-bounds,
 * coverage gap, zero goals → null/unavailable. The null-collapsing wrapper
 * `proposeIsolatedIntent` still returns null for compound — legacy callers
 * see exactly the old behavior (INV-GI-4).
 */

import { createHash } from "node:crypto";

import { createProposerModelCall } from "../../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../../intake/llm-classifier.js";
import {
  INTENT_SEGMENT_CATEGORIES,
  type IntentSegmentCategory,
  type IsolatedIntent,
  type IsolatedIntentSegment,
  type IntentSpan,
} from "./types.js";

// ─── Bounds (INV-GI-7 / INV-AI-5) ─────────────────────────────────────────────

/** Inputs longer than this never touch a model (cost + prompt-injection bound). */
export const MAX_ISOLATION_INPUT_LENGTH = 8_000;

/** Maximum spans (goal + segments) in one proposal. */
export const MAX_ISOLATION_SPANS = 24;

/** Maximum goal span length — a "goal" that is most of the blob is not isolated. */
export const MAX_GOAL_LENGTH = 400;

/**
 * Single-clause boundary (INV-TT-4, USESTEADY_UNDERSTANDING_TURN_TYPE_TAXONOMY_V1).
 * A whole-blob "goal" is a legitimate isolation only for a short single-clause
 * imperative ("start Phase 1"). For a longer or multi-line input, a goal that
 * covers the entire message means no partition happened — a low-confidence
 * isolation, which is not an isolation. Measured on two founder corpora
 * (1,377 + 2,826 rows): short legitimate imperatives are <=12 words; the
 * whole-blob echoes that should have segmented are all >12 words or multi-line.
 */
export const MAX_WHOLE_BLOB_GOAL_WORDS = 12;

/**
 * Maximum GOAL spans in a `compound` reading (taxonomy slice 3). More than
 * this is not a compound request a human can pick from — it is noise, and the
 * proposal fails closed to unavailable.
 */
export const MAX_COMPOUND_GOALS = 6;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * INV-TT-4: a candidate whose single GOAL span covers the whole (non-whitespace)
 * input with no other segments is only a real isolation when the input is a
 * short single-clause imperative. A long or multi-line whole-blob "goal" is a
 * compound the seam failed to partition — it must fail closed to
 * `cannot_isolate`, never surface as a confident candidate.
 */
function isWholeBlobEcho(rawInput: string, located: readonly LocatedSpan[]): boolean {
  const segments = located.filter((s) => s.category !== "goal");
  if (segments.length > 0) return false;
  const goal = located.find((s) => s.category === "goal");
  if (!goal) return false;
  if (goal.text.trim() !== rawInput.trim()) return false;
  return /\n/.test(rawInput) || wordCount(rawInput) > MAX_WHOLE_BLOB_GOAL_WORDS;
}

// ─── Injectable model call ────────────────────────────────────────────────────

/** Injectable model call for tests; production uses the Anthropic default. */
export type IsolationModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

// ─── System prompt ────────────────────────────────────────────────────────────

const CATEGORY_LIST = ["GOAL", "CONTEXT", "EVIDENCE", "INSTRUCTION", "EXAMPLE", "CONSTRAINT"];

const SYSTEM_PROMPT = `You are a goal-isolation reader for UseSteady, a governed work tool.

## Your job
Partition the user's message into consecutive verbatim spans, in original order.
Return ONLY a valid JSON object. No prose, no markdown, no explanation.

## Span categories (the ONLY six)
- GOAL        — the user's operative intent: what they want to accomplish. EXACTLY ONE span.
- CONTEXT     — background about their situation ("I copied this from our website...")
- EVIDENCE    — pasted artifacts: logs, code, markup, stack traces, titles, data
- INSTRUCTION — directives about how to proceed ("blueprint the plan first", "don't touch prod")
- EXAMPLE     — illustrative samples the user provides
- CONSTRAINT  — limits and requirements ("no billing", "must stay on Node 20")

## HARD RULES
- Every span's "text" must be COPIED CHARACTER-FOR-CHARACTER from the message. Never
  paraphrase, never fix typos, never merge distant sentences.
- Spans must appear in the same order as in the message and must not overlap.
- Together the spans must cover the whole message FROM ITS FIRST CHARACTER TO ITS
  LAST; only whitespace may fall between spans. Filler openers ("Lets", "Hey", "So",
  "Okay"), trailing punctuation, and sentence periods are NOT skippable — include
  them in the nearest span. A dropped word or dropped punctuation mark invalidates
  the whole answer.
- Mark ONE span GOAL when the message asks for one thing. If the message asks for
  MORE THAN ONE distinct thing, mark EACH ask as its own GOAL span — do not merge
  them and do not pick one yourself. If you cannot identify any goal with
  confidence, return {"spans": []} — never guess and never mark the whole message GOAL.
- A GOAL span is one contiguous statement, not the entire message.

## Worked example
Message: "Lets add rate limiting to the API. Don't touch auth."
{"spans": [{"category": "GOAL", "text": "Lets add rate limiting to the API."},
           {"category": "CONSTRAINT", "text": "Don't touch auth."}]}
Note the GOAL span keeps "Lets" and the period — nothing is dropped.

## Worked example (more than one ask)
Message: "Fix the login bug. Also improve the dashboard."
{"spans": [{"category": "GOAL", "text": "Fix the login bug."},
           {"category": "GOAL", "text": "Also improve the dashboard."}]}

## JSON output schema
{"spans": [{"category": ${CATEGORY_LIST.map((c) => `"${c}"`).join(" | ")}, "text": "<verbatim>"}]}

Return ONLY valid JSON.`;

// ─── Raw model output shapes ──────────────────────────────────────────────────

type RawSpan = { readonly category?: unknown; readonly text?: unknown };

const RAW_TO_CATEGORY: Record<string, IntentSegmentCategory | "goal"> = {
  GOAL: "goal",
  CONTEXT: "context",
  EVIDENCE: "evidence",
  INSTRUCTION: "instruction",
  EXAMPLE: "example",
  CONSTRAINT: "constraint",
};

// ─── Structural re-validation ─────────────────────────────────────────────────

export type LocatedSpan = {
  readonly category: IntentSegmentCategory | "goal";
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

/**
 * Re-locate every proposed span in the original input, left to right, and
 * enforce verbatim / order / coverage structurally. Returns the located spans
 * (with offsets WE computed) or null when anything is off.
 *
 * Goal count: 1 goal is a candidate; 2..MAX_COMPOUND_GOALS is a structurally
 * valid `compound` reading (taxonomy slice 3) — the outcome layer decides
 * which. Zero goals or more than MAX_COMPOUND_GOALS is rejected here.
 *
 * Exported for direct testing; the proposer is its only production caller.
 */
export function locateAndValidateSpans(
  rawInput: string,
  rawSpans: readonly RawSpan[],
): readonly LocatedSpan[] | null {
  if (rawSpans.length === 0 || rawSpans.length > MAX_ISOLATION_SPANS) return null;

  const located: LocatedSpan[] = [];
  let cursor = 0;
  let goalCount = 0;

  for (const raw of rawSpans) {
    if (typeof raw.category !== "string" || typeof raw.text !== "string") return null;
    const category = RAW_TO_CATEGORY[raw.category];
    if (category === undefined) return null;

    const text = raw.text;
    if (text.trim().length === 0) return null;

    // Verbatim + order in one step: the span must appear at or after the
    // cursor. Offsets are derived here, never trusted from the model.
    const start = rawInput.indexOf(text, cursor);
    if (start === -1) return null;

    // Total coverage: only whitespace may be skipped between spans.
    if (rawInput.slice(cursor, start).trim().length > 0) return null;

    const end = start + text.length;
    if (category === "goal") {
      goalCount += 1;
      if (goalCount > MAX_COMPOUND_GOALS) return null;
      if (text.length > MAX_GOAL_LENGTH) return null;
    }

    located.push({ category, text, start, end });
    cursor = end;
  }

  // Tail coverage: nothing meaningful may be dropped after the last span.
  if (rawInput.slice(cursor).trim().length > 0) return null;

  if (goalCount === 0) return null;
  return located;
}

// ─── Default model call (Moonshot/Kimi default / Anthropic R6 — INV-AI-5) ────────────

const defaultIsolationCall = createProposerModelCall({ maxTokens: 1024 });

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * INV-GI-3 distinguishes the two honest failure shapes:
 *
 *   - "cannot_isolate" — the model responded with a well-formed, explicit
 *     `{"spans": []}`: "I cannot identify exactly one goal". Surfaces as the
 *     honest "could not isolate a goal" state (INV-GI-3b).
 *   - "unavailable"    — no key, API error, malformed JSON, or a proposal that
 *     failed structural re-validation. The caller behaves exactly as before
 *     this seam existed (INV-GI-3a); nothing is surfaced.
 *
 * A failed re-validation is "unavailable", not "cannot_isolate": a model that
 * invented or dropped text cannot be trusted to have honestly said "no goal".
 *
 * Taxonomy slice 3 (USESTEADY_UNDERSTANDING_TURN_TYPE_TAXONOMY_V1, `compound`):
 *
 *   - "compound" — the proposal is structurally valid (verbatim, ordered,
 *     total coverage) and carries 2..MAX_COMPOUND_GOALS GOAL spans: the
 *     message asks for more than one thing. The candidate goals are listed,
 *     in document order, so a human can say which one is the request. Zero
 *     authority — nothing consumes a compound goal without a human choice.
 */
export type GoalIsolationOutcome =
  | { readonly kind: "candidate"; readonly intent: IsolatedIntent }
  | { readonly kind: "compound"; readonly goals: readonly IntentSpan[] }
  | { readonly kind: "cannot_isolate" }
  | { readonly kind: "unavailable" };

/**
 * Propose an IsolatedIntent reading of one confirmed raw input, with the two
 * failure shapes kept distinct (see GoalIsolationOutcome). Never fabricates a
 * whole-blob goal.
 */
export async function proposeIsolatedIntentOutcome(
  rawInput: string,
  callModel: IsolationModelCall = defaultIsolationCall,
): Promise<GoalIsolationOutcome> {
  const UNAVAILABLE = { kind: "unavailable" } as const;
  if (rawInput.trim().length === 0) return UNAVAILABLE;
  if (rawInput.length > MAX_ISOLATION_INPUT_LENGTH) return UNAVAILABLE;

  let text: string | null;
  try {
    text = await callModel(SYSTEM_PROMPT, rawInput);
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
  const spansRaw = (raw as { spans?: unknown }).spans;
  if (!Array.isArray(spansRaw)) return UNAVAILABLE;

  // The model's explicit, well-formed "I cannot isolate exactly one goal".
  if (spansRaw.length === 0) return { kind: "cannot_isolate" };

  const located = locateAndValidateSpans(rawInput, spansRaw as RawSpan[]);
  if (located === null) return UNAVAILABLE;

  // INV-TT-4: a long / multi-line whole-blob "goal" is a compound the seam
  // failed to partition, not a confident isolation. Fail closed to the honest
  // "no single goal" shape rather than surface the whole blob as the goal.
  if (isWholeBlobEcho(rawInput, located)) return { kind: "cannot_isolate" };

  // Taxonomy slice 3: 2+ structurally valid GOAL spans = the honest compound
  // reading. The goals are surfaced for a human pick; never chosen by us.
  const goalSpans = located.filter((s) => s.category === "goal");
  if (goalSpans.length > 1) {
    return {
      kind:  "compound",
      goals: goalSpans.map((s) => ({ text: s.text, start: s.start, end: s.end })),
    };
  }

  let goal: IntentSpan | null = null;
  const segments: IsolatedIntentSegment[] = [];
  for (const span of located) {
    if (span.category === "goal") {
      goal = { text: span.text, start: span.start, end: span.end };
    } else {
      segments.push({
        category: span.category,
        text:     span.text,
        start:    span.start,
        end:      span.end,
      });
    }
  }
  // locateAndValidateSpans guarantees exactly one goal; this is a type guard.
  if (goal === null) return UNAVAILABLE;

  return {
    kind: "candidate",
    intent: {
      goal,
      segments,
      source: {
        rawInputSha256: createHash("sha256").update(rawInput, "utf8").digest("hex"),
        length:         rawInput.length,
      },
      proposedBy: "model",
    },
  };
}

/**
 * Convenience wrapper collapsing both failure shapes to null (INV-GI-3
 * fail-closed). Callers that need the honest "could not isolate a goal"
 * distinction use proposeIsolatedIntentOutcome.
 */
export async function proposeIsolatedIntent(
  rawInput: string,
  callModel: IsolationModelCall = defaultIsolationCall,
): Promise<IsolatedIntent | null> {
  const outcome = await proposeIsolatedIntentOutcome(rawInput, callModel);
  return outcome.kind === "candidate" ? outcome.intent : null;
}
