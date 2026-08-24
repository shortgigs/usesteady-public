/**
 * UseSteady Skills v1 — local deterministic recovery adapter.
 *
 * ── Purpose ────────────────────────────────────────────────────────────────────
 *
 *   Implements SkillModelAdapter for the recovery skill kind WITHOUT calling
 *   an LLM. Uses keyword detection and simple name extraction to produce
 *   conservative, specific suggestions.
 *
 * ── Authority ──────────────────────────────────────────────────────────────────
 *
 *   Zero. This adapter:
 *     - never executes anything
 *     - never calls tools
 *     - never bypasses approval or policy
 *     - may only return suggestions that the deterministic parser can validate
 *
 * ── Design rules ───────────────────────────────────────────────────────────────
 *
 *   1. Every `input` in a suggestion MUST be parseable by normalizeIntent().
 *      Do not suggest phrases the parser cannot handle.
 *   2. Return `suggestions: []` when the input is too vague or no safe
 *      suggestion exists. Never fabricate plausible-sounding but unsupported inputs.
 *   3. This adapter only handles `usesteady.recovery_suggestions.v1` output.
 *      For other skill output schemas it returns null (declined).
 *   4. No LLM — all logic is deterministic regex/keyword matching.
 *      A real LLM adapter can replace this when a model is available.
 *
 * ── Replacement plan ───────────────────────────────────────────────────────────
 *
 *   When an LLM is available, create an LlmRecoveryAdapter that also implements
 *   SkillModelAdapter. Swap it in at server startup. This adapter stays as the
 *   fallback for offline / zero-API-key environments.
 */
import type { Skill, SkillOutput } from './types.js';
import type { SkillModelAdapter } from './invocation.js';
/**
 * LocalRecoveryAdapter — deterministic SkillModelAdapter for the recovery kind.
 *
 * Returns a RecoverySuggestionsOutput built from keyword analysis.
 * Returns null (declined) for non-recovery skill output schemas.
 *
 * This adapter satisfies SkillModelAdapter and can be replaced by an
 * LLM-backed adapter without changing any call sites.
 */
export declare class LocalRecoveryAdapter implements SkillModelAdapter {
    invoke(skill: Skill, rawInput: string): Promise<SkillOutput | null>;
}
//# sourceMappingURL=local-recovery-adapter.d.ts.map