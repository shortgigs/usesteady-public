/**
 * Intent Completion types.
 *
 * ── Result kinds ──────────────────────────────────────────────────────────────
 *
 *   complete        — input is deterministically actionable
 *
 *   incomplete      — intent is unambiguous, a required field is MISSING
 *                     e.g. "commit my changes" → missing commit message
 *                     The user knows what they want; the system knows what's needed.
 *
 *   guided_recovery — intent is vague; system can offer a safe path forward
 *                     e.g. "make button blue" → read file first, then replace
 *                     The user may not know the exact form; the system guides.
 *
 * ── Semantic contract ─────────────────────────────────────────────────────────
 *
 *   incomplete      ≠ guided_recovery
 *
 *   incomplete:       commit my changes → missing message → commit ""
 *   guided_recovery:  make button blue  → vague intent   → read "" then replace "" with "" in ""
 *
 * ── CompletionRule ────────────────────────────────────────────────────────────
 *
 *   Completion is registry-driven. Each rule owns a named, testable pattern.
 *   Rules receive UnderstandContext so context-dependent inputs
 *   ("run again", "same as before") can be resolved when prior session exists.
 *
 *   CONTRACT: Completion is the sole authority on executability.
 *   Disambiguation returning unknown does NOT block completion from returning complete.
 *   Context-dependent executable intent is resolved HERE, not upstream.
 */
import type { UnderstandContext } from "../shared/types.js";
export type CompletionNextStep = {
    readonly type: "read_first" | "use_exact_format" | "add_missing_field";
    readonly label: string;
};
export type CompletionResult = {
    readonly kind: "complete";
} | {
    readonly kind: "incomplete";
    readonly reason: string;
    readonly missing: readonly string[];
    readonly nextSteps: readonly CompletionNextStep[];
} | {
    readonly kind: "guided_recovery";
    readonly reason: string;
    readonly missing: readonly string[];
    readonly nextSteps: readonly CompletionNextStep[];
};
/**
 * A CompletionRule owns a named, prioritised, testable completion pattern.
 *
 * Rules MUST:
 *   - Be deterministic (same input + ctx → same output, always)
 *   - Return null only when the input is outside the rule's scope
 *   - Never guess or infer missing values
 *
 * Priority: lower number = runs first.
 * First matching non-null result wins.
 */
export type CompletionRule = {
    readonly id: string;
    readonly priority: number;
    matches(input: string, ctx: UnderstandContext): boolean;
    evaluate(input: string, ctx: UnderstandContext): CompletionResult | null;
};
//# sourceMappingURL=types.d.ts.map