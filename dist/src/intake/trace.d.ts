/**
 * DebugTrace — the internal pipeline trace for observability.
 *
 * Produced by runIntakeWithTrace. Absent from normal runIntake output.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * Answers the developer question: "At each gate, what fired and why?"
 *
 * Without this, reasoning about guide vs clarify vs execute requires
 * mentally re-running the full pipeline. With trace, you can see:
 *
 *   - Did PRV pass?
 *   - Did safety block early?
 *   - Was the input aligned, social, or a context mismatch?
 *   - Was disambiguation ambiguous?
 *   - What did completion decide?
 *   - Did the Intent Interpretation Bridge fire and classify something?
 *   - If the bridge was silent, which guidance template was applied?
 *
 * ── Zero authority ────────────────────────────────────────────────────────────
 *
 * DebugTrace is observability data only.
 * It has zero effect on IntakeResult.
 * It does not change mode, signal, intentState, or guidance.
 * It does not change safety verdicts.
 * It does not change what executes.
 *
 * Any code that reads DebugTrace to make a decision is wrong.
 *
 * ── "not_reached" sentinel ────────────────────────────────────────────────────
 *
 * When a pipeline step short-circuits (PRV fails, safety blocks, etc.),
 * subsequent steps never ran. Their fields show "not_reached" to make
 * the short-circuit point explicit and inspectable — not a default value.
 */
import type { SilentGuidanceMode } from "../understand/silent-guidance/types.js";
export type DebugTrace = {
    /**
     * PRV result.
     * false = PRV found a context-dependency marker with no available context.
     * true  = PRV passed (either no marker, or context is available).
     */
    readonly prvPassed: boolean;
    /**
     * Safety Gate verdict.
     * "allow"       = gate passed
     * "block"       = input matched a safety detector
     * "not_reached" = PRV short-circuited before safety ran
     */
    readonly safetyVerdict: "allow" | "block" | "not_reached";
    /**
     * Context Alignment classification.
     * "aligned"      = normal task input
     * "non_literal"  = social / greeting
     * "hard_mismatch"= context reference with no context available
     * "not_reached"  = an earlier step short-circuited
     */
    readonly contextKind: "aligned" | "non_literal" | "hard_mismatch" | "not_reached";
    /**
     * Disambiguation classification.
     * "clear"       = input was positively normalized
     * "ambiguous"   = multiple valid interpretations, short-circuited to clarify
     * "unknown"     = no ambiguity detected, fell through to completion
     * "not_reached" = an earlier step short-circuited
     */
    readonly disambigKind: "clear" | "ambiguous" | "unknown" | "not_reached";
    /**
     * Completion result kind.
     * "complete"        = input is actionable
     * "incomplete"      = intent is clear, a required field is missing
     * "guided_recovery" = intent is vague, safe next-step path provided
     * "not_reached"     = an earlier step short-circuited
     */
    readonly completionKind: "complete" | "incomplete" | "guided_recovery" | "not_reached";
    /**
     * Whether the Intent Interpretation Bridge ran and produced a classification.
     *
     * true  = bridge ran (guided_recovery or incomplete completion) AND an interpreter
     *         claimed the input (guidance.interpretation is present in the result)
     * false = bridge did not run (completion was not guide-mode), or ran but no
     *         interpreter claimed the input (guidance.interpretation is absent)
     *
     * This is the most useful single signal for debugging guide mode behavior.
     * If guide mode feels unhelpful, bridgeFired: false tells you the bridge had
     * no signal to work with. See bridgeSilenceReason for the runtime observable cause.
     */
    readonly bridgeFired: boolean;
    /**
     * Why the bridge stayed silent on this guide flow.
     *
     * Present ONLY when:
     *   - completionKind is "guided_recovery" or "incomplete" (bridge was eligible to run), AND
     *   - bridgeFired === false (no interpreter claimed the input)
     *
     * This separates three cleanly distinct states:
     *   bridgeFired = true                          → bridge ran and classified the input
     *   bridgeFired = false + silenceReason present → bridge was eligible; nothing claimed it
     *   bridgeFired = false + silenceReason absent  → bridge was not eligible (non-guide path)
     *
     * ── Current values ────────────────────────────────────────────────────────
     *
     * "no_interpreter_claimed"
     *   The bridge ran the full interpreter registry; every interpreter returned null.
     *   This is the ONLY observable runtime fact. The specific reason why no interpreter
     *   claimed the input (ambiguous domain, value invention required, safety adjacency, etc.)
     *   is a human gate evaluation — not a runtime decision.
     *   See: tests/intake/when-not-to-build.test.ts for the formal per-flow rationale.
     *
     * ── Closed enum rule (LOCKED) ─────────────────────────────────────────────
     *
     *   bridgeSilenceReason is observational only.
     *   It MUST remain a closed, runtime-provable enum.
     *
     *   A new value may ONLY be added if it is:
     *     1. Directly observable   — detectable mechanically at bridge-run time
     *     2. Mechanically provable — not inferred, not assumed, not approximated
     *     3. Non-interpretive      — does not explain WHY (that is the human gate's job)
     *
     *   DO NOT add values that:
     *     - Encode gate criteria (C1–C5) — those are human evaluations, not runtime facts
     *     - Explain ambiguity or domain mismatch — those require inference
     *     - Duplicate information already in completionKind or other trace fields
     *
     * ── Internal-only, never exposed to users ────────────────────────────────
     *
     *   This field MUST NOT:
     *     - Appear in IntakeResult
     *     - Appear in GuidancePayload
     *     - Affect mode, guidance, interpretation, or any decision path
     *
     *   Any code that reads bridgeSilenceReason to make a decision is wrong.
     */
    readonly bridgeSilenceReason?: "no_interpreter_claimed";
    /**
     * The silent guidance mode applied to this bridge-silent flow.
     *
     * Present ONLY when bridgeSilenceReason === "no_interpreter_claimed".
     * Records which generic guidance template was selected to replace the
     * default code-patch steps.
     *
     * ── Zero authority ────────────────────────────────────────────────────────
     *
     *   This field is observational only.
     *   It records the template decision; it does not drive any other decision.
     *
     *   This field MUST NOT:
     *     - Appear in IntakeResult
     *     - Appear in GuidancePayload (beyond nextSteps being shaped by it)
     *     - Affect mode, signal, intentState, or interpretation
     *     - Enter UCP envelopes
     *
     *   Any code that reads silentGuidanceMode to make a routing decision is wrong.
     */
    readonly silentGuidanceMode?: SilentGuidanceMode;
};
//# sourceMappingURL=trace.d.ts.map