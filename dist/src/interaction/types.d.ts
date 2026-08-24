/**
 * Interaction Contract types.
 *
 * The InteractionContract is a lightweight, immutable record that captures
 * how a subject (user/session) interacts with UseSteady.
 *
 * It is:
 *   - Deterministic: same events produce same transitions
 *   - Pure: no I/O, no side effects in updater
 *   - Not a profile: no personal data, no identity tracking
 *   - Not persistent: in-memory only in this phase
 *
 * The source field tracks confidence:
 *   - "default"        → never adjusted
 *   - "observed"       → adjusted from behavioral signals
 *   - "user_confirmed" → explicitly set by user action
 *
 * ── observedIntentPatterns (advisory session signal) ─────────────────────────
 *
 * Records how many times each intent category was seen in this session.
 * These counts are produced only when the Intent Interpretation Bridge
 * fired AND produced a classification (bridgeFired: true in DebugTrace).
 *
 * CONTRACTS (non-negotiable, must not be violated):
 *
 *   1. observedIntentPatterns is advisory only.
 *      It records what was observed. It adapts nothing automatically.
 *
 *   2. It may only ever affect (in Phase B2, not before):
 *        - guidance ordering
 *        - guidance emphasis
 *        - example ordering
 *
 *   3. It must NEVER affect:
 *        - PRV result
 *        - Safety Gate verdict
 *        - Context Alignment result
 *        - Disambiguation result
 *        - Completion result
 *        - Response mode / intentState
 *        - Interpretation category or confidence
 *
 *   4. No observation event may fire unless bridgeFired === true in the trace.
 *      This ensures counts track meaningful guided interpretations only —
 *      not generic noise, vague inputs, or incomplete completions.
 */
export type ObservedIntentPatterns = {
    /**
     * Number of times visual_color was the classified intent category
     * in a guided_recovery flow where bridgeFired === true.
     */
    readonly visual_color: number;
    /**
     * Number of times text_change was the classified intent category
     * in a guided_recovery flow where bridgeFired === true.
     */
    readonly text_change: number;
    /**
     * Number of times config_change was the classified intent category
     * in a guided_recovery flow where bridgeFired === true.
     */
    readonly config_change: number;
};
export type InteractionContract = {
    readonly version: 1;
    readonly subjectId: string;
    readonly ambiguityMode: "conservative" | "balanced" | "fast";
    readonly explanationMode: "plain_first" | "technical_first" | "mixed";
    readonly unsupportedGuidanceMode: "syntax_first" | "examples_first" | "stepwise";
    readonly updatedAt: string;
    readonly source: "default" | "user_confirmed" | "observed";
    /**
     * Advisory session signal — see contracts above.
     * All counts default to 0. Incremented by observation events only.
     * Phase B2 (not yet built) will read these to order guidance.
     */
    readonly observedIntentPatterns: ObservedIntentPatterns;
};
/**
 * Events that may update the contract.
 *
 * Events are behavioral observations, not explicit user preferences.
 * Only high-signal, low-ambiguity events are defined.
 *
 * ── Observation events (Phase B1) ────────────────────────────────────────────
 *
 * color_intent_observed, text_intent_observed, config_intent_observed
 *   → Fire only when: mode === "guide" AND guidance.interpretation exists
 *     AND trace.bridgeFired === true.
 *   → Increment the corresponding observedIntentPatterns count.
 *   → See observeIntentPattern() in interaction/observe.ts for the gating logic.
 */
export type InteractionEvent = {
    readonly type: "misinterpretation_corrected";
} | {
    readonly type: "unsupported_recovered";
    readonly recoveryStyle: "syntax_hint" | "example_used" | "stepwise_followed";
} | {
    readonly type: "color_intent_observed";
} | {
    readonly type: "text_intent_observed";
} | {
    readonly type: "config_intent_observed";
};
//# sourceMappingURL=types.d.ts.map