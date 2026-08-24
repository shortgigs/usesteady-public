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
import type { LLMClassification } from "./intent-families.js";
/**
 * Strip a markdown code fence when the model wraps its JSON despite the
 * "no markdown" instruction (Haiku-class models frequently do). Anything that
 * still fails JSON.parse after this returns null via the caller's catch —
 * fail-closed behavior is unchanged (L2.S2 defect fix).
 */
export declare function extractJsonText(text: string): string;
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
export declare function classifyIntent(input: string): Promise<LLMClassification | null>;
//# sourceMappingURL=llm-classifier.d.ts.map