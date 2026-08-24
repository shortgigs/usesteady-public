/**
 * Intent Interpretation Bridge types.
 *
 * ── Two interpretation families ────────────────────────────────────────────────
 *
 *   Change Interpretation (src/understand/interpretation/)
 *     → For executable, structured commands: replace "X" with "Y" in <file>
 *     → Runs when mode === "execute"
 *     → Describes what the change means after the fact
 *
 *   Intent Interpretation Bridge (this module)
 *     → For vague, incomplete requests: "make the button blue"
 *     → Runs when CompletionResult.kind === "guided_recovery"
 *     → Describes what the user appears to be trying to do
 *     → Improves guidance labels — never invents missing values
 *
 * ── Scope contract ─────────────────────────────────────────────────────────────
 *
 *   The bridge MAY:
 *     - Classify broad intent category (visual_color, text_change, config_change, workflow_operation)
 *     - Rewrite guidance labels in human language
 *     - Add rationale to "read first" steps
 *     - Record what signals triggered the classification (basis[])
 *     - Run for both guided_recovery and incomplete completion results (both become guide mode)
 *
 *   The bridge MUST NOT:
 *     - Guess file paths
 *     - Guess current or new values
 *     - Turn guided_recovery or incomplete into complete
 *     - Downgrade safety
 *     - Override mode
 *
 * ── GuidancePayload (home of record) ─────────────────────────────────────────
 *
 *   GuidancePayload lives here because it is enriched by this layer.
 *   intake/types.ts re-imports it from here to avoid circular dependencies.
 *   (understand → intake would be upward; this module is understand-level.)
 */
import type { CompletionNextStep } from "../completion/types.js";
import type { LLMClassification } from "../../intake/intent-families.js";
import type { SilentGuidanceMode } from "../silent-guidance/types.js";
export type IntentInterpretationCategory = "visual_color" | "text_change" | "config_change" | "workflow_operation" | "unknown";
export type IntentInterpretation = {
    readonly category: IntentInterpretationCategory;
    readonly summary: string;
    readonly confidence: "high" | "medium" | "low";
    /**
     * Inspectable evidence: what signals triggered this classification.
     * Examples: ["matched color word: blue", "ui target term: button"]
     * Never empty when category !== "unknown".
     */
    readonly basis: readonly string[];
};
/**
 * GuidancePayload — the structured next-step payload for guide mode.
 *
 * When the bridge runs, it may attach an IntentInterpretation and rewrite
 * nextSteps labels to be context-aware. It never fills in missing values.
 *
 * CONTRACT: interpretation is present only when category !== "unknown".
 */
export type GuidancePayload = {
    readonly missing: readonly string[];
    readonly nextSteps: readonly CompletionNextStep[];
    readonly interpretation?: IntentInterpretation;
    /**
     * Intake v2 — LLM-assisted classification, present only when:
     *   - mode === "guide"
     *   - the Intent Interpretation Bridge produced no interpretation (bridge-silent)
     *   - ANTHROPIC_API_KEY is set and the API call succeeded
     *
     * Advisory only. Never affects mode, signal, intentState, or missing[].
     * Consumers use it to render richer, structured guidance.
     */
    readonly llmClassification?: LLMClassification;
    /**
     * Phase 4C — the silent guidance template mode selected for bridge-silent
     * flows. Present when mode === "guide" AND no interpreter claimed the input.
     *
     * Used for observability (PostHog family-level tracking) and future
     * rendering variants. Never affects mode, signal, intentState, or missing[].
     */
    readonly silentGuidanceMode?: SilentGuidanceMode;
};
/**
 * An IntentInterpreter classifies a user's vague input into a broad intent
 * category and provides human-readable classification evidence.
 *
 * Rules:
 *   - Must be deterministic (same input → same output, always)
 *   - Must return null if input is outside its scope
 *   - Must populate basis[] with specific matched evidence
 *   - Must never infer values not present in the input text
 *
 * Priority: lower number = runs first.
 */
export type IntentInterpreter = {
    readonly id: string;
    readonly priority: number;
    matches(input: string): boolean;
    interpret(input: string): IntentInterpretation | null;
};
//# sourceMappingURL=types.d.ts.map