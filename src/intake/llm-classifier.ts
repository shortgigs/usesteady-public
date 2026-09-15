/**
 * LLM Classifier — Intake v2.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────
 *
 *   classifyIntent(input) calls the Anthropic API with a bounded system prompt
 *   and returns a validated LLMClassification, or null on any failure.
 *
 * ── Hard rules (non-negotiable) ───────────────────────────────────────────────
 *
 *   1. The system prompt explicitly forbids suggested_rewrite for guided-only
 *      families. The model is instructed never to produce one.
 *
 *   2. Post-parse validation strips suggested_rewrite for guided-only families
 *      even when the model violates the prompt instruction (defense-in-depth).
 *
 *   3. Returns null on: missing API key, API error, JSON parse failure,
 *      schema violation. The caller must handle null with a safe fallback.
 *
 *   4. LLM may widen understanding. It may not widen execution.
 *      The five frozen operations (rename/replace/create/delete/run) are
 *      enforced here — any rewrite implying a different operation is stripped.
 *
 * ── What the LLM does here ────────────────────────────────────────────────────
 *
 *   ONLY: intent classification, slot extraction, missing-slot identification,
 *         clarification question generation (for direct-capable + missing slots),
 *         rewrite suggestion (for direct-capable + all slots present).
 *
 *   NEVER: generate final execution tasks, guess slot values from context,
 *          bypass the controller, suggest operations outside the frozen set.
 */

import {
  createProposerModelCall,
  isProposerProviderConfigured,
} from "../ai-seams/proposer-model-call.js";
import {
  DIRECT_CAPABLE_FAMILIES,
  GUIDED_ONLY_FAMILIES,
  REQUIRED_SLOTS,
  isDirectCapable,
} from "./intent-families.js";
import type {
  LLMClassification,
  IntentFamily,
  IntentSlots,
} from "./intent-families.js";

/** Bounded Moonshot/Kimi default call (INV-AI-5); Anthropic override/R6. */
const classifyModelCall = createProposerModelCall({ maxTokens: 512 });

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an intent classifier for UseSteady, a file-operation safety tool.

## Your job
Classify user input into ONE intent family and extract operation slots.
Return ONLY a valid JSON object. No prose, no markdown, no explanation.

## Intent families

### Direct-capable — may produce suggested_rewrite when ALL required slots are present
${DIRECT_CAPABLE_FAMILIES.map(f => `- ${f}`).join("\n")}

### Guided-only — NEVER produce suggested_rewrite; use clarification_question or boundary_reason instead
${GUIDED_ONLY_FAMILIES.map(f => `- ${f}`).join("\n")}

## HARD RULE — guided-only families
If intent_family is any of: ${GUIDED_ONLY_FAMILIES.join(", ")}
→ You MUST NOT set suggested_rewrite.
→ You MUST set clarification_question OR boundary_reason.

## Required slots per direct-capable family
${DIRECT_CAPABLE_FAMILIES.map(f => `- ${f}: ${REQUIRED_SLOTS[f].join(", ")}`).join("\n")}

If intent_family is direct-capable but any required slot is absent from the input:
→ Do NOT set suggested_rewrite.
→ Set clarification_question asking for the first missing slot only.

## Slot definitions
- source_path: file or directory to act on (must come from user input — never inferred)
- target_path: destination path for rename/move (must come from user input — never inferred)
- old_value:   the exact value being replaced (replace family)
- new_value:   the replacement value or new content
- command:     the shell command to run (run family)

## CRITICAL: never guess
If a slot value is not explicitly present in the user input, omit it.
Do not infer, expand, or complete file paths or values.

## JSON output schema
{
  "intent_family": "<family name>",
  "confidence": <0.0–1.0>,
  "slots": { <only fields explicitly found in input> },
  "missing_slots": ["<required slot names that are absent>"],
  "suggested_rewrite": "<rewrite — ONLY for direct-capable with all slots present>",
  "clarification_question": "<one question — omit when suggested_rewrite is present>",
  "boundary_reason": "<reason — only when intent_family is boundary>"
}

Omit any key that does not apply. Return ONLY valid JSON.`;

// ─── Post-parse validator ─────────────────────────────────────────────────────

type RawClassification = Record<string, unknown>;

function isValidFamily(v: unknown): v is IntentFamily {
  return (
    typeof v === "string" &&
    ([...DIRECT_CAPABLE_FAMILIES, ...GUIDED_ONLY_FAMILIES] as string[]).includes(v)
  );
}

function sanitizeSlots(raw: unknown): IntentSlots {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["source_path", "target_path", "old_value", "new_value", "command"]) {
    if (typeof r[key] === "string" && (r[key] as string).trim() !== "") {
      out[key] = (r[key] as string).trim();
    }
  }
  return out as IntentSlots;
}

function sanitizeMissingSlots(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string");
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Validate and sanitize the raw LLM output.
 *
 * Defense-in-depth enforcement:
 *   - guided-only families: suggested_rewrite stripped unconditionally
 *   - direct-capable with missing slots: suggested_rewrite stripped
 *   - confidence clamped to [0, 1]
 */
function validate(raw: RawClassification): LLMClassification | null {
  if (!isValidFamily(raw["intent_family"])) return null;

  const family:     IntentFamily = raw["intent_family"];
  const confidence: number       = typeof raw["confidence"] === "number"
    ? Math.max(0, Math.min(1, raw["confidence"]))
    : 0.5;

  const slots        = sanitizeSlots(raw["slots"]);
  const missingSlots = sanitizeMissingSlots(raw["missing_slots"]);

  const rawRewrite  = optStr(raw["suggested_rewrite"]);
  const rawClarify  = optStr(raw["clarification_question"]);
  const rawBoundary = optStr(raw["boundary_reason"]);

  // HARD RULE: guided-only families must never carry suggested_rewrite.
  // Also strip if required slots are missing — clarification must come first.
  const allowRewrite = isDirectCapable(family) && missingSlots.length === 0;
  const finalRewrite = allowRewrite ? rawRewrite : undefined;

  return {
    intent_family:  family,
    confidence,
    slots,
    missing_slots:  missingSlots,
    ...(finalRewrite  !== undefined ? { suggested_rewrite:      finalRewrite  } : {}),
    ...(rawClarify    !== undefined ? { clarification_question: rawClarify    } : {}),
    ...(rawBoundary   !== undefined ? { boundary_reason:        rawBoundary   } : {}),
  };
}

/**
 * Strip a markdown code fence when the model wraps its JSON despite the
 * "no markdown" instruction (Haiku-class models frequently do). Anything that
 * still fails JSON.parse after this returns null via the caller's catch —
 * fail-closed behavior is unchanged (L2.S2 defect fix).
 */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify user intent via LLM.
 *
 * Returns null when:
 *   - Active proposer provider has no API key (safe no-key path for CI / offline)
 *   - API call fails for any reason
 *   - Response cannot be parsed as JSON
 *   - Parsed object fails schema validation
 *
 * The caller must always handle null with a safe, non-LLM fallback.
 * Default provider is xAI / Grok (`grok-3`); Moonshot/Kimi is explicit override
 * or R6 operational fallback; Anthropic is explicit override / secondary R6
 * (see docs/ai-seams-proposer-providers.md).
 */
export async function classifyIntent(
  input: string,
): Promise<LLMClassification | null> {
  if (!isProposerProviderConfigured()) return null;

  try {
    const text = await classifyModelCall(SYSTEM_PROMPT, input);
    if (text === null) return null;

    const raw: RawClassification = JSON.parse(extractJsonText(text)) as RawClassification;
    return validate(raw);
  } catch {
    return null;
  }
}
