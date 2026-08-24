/**
 * Intake pipeline types.
 *
 * ── Signal contract ───────────────────────────────────────────────────────────
 *
 *   IntakeSignal is the PUBLIC output signal.
 *   It does NOT include `unknown` from disambiguation — that is an internal
 *   intermediate state meaning "no ambiguity detected; fall through to completion."
 *
 * ── Dual interpretation contract ──────────────────────────────────────────────
 *
 *   IntakeResult carries two distinct, independent interpretation fields:
 *
 *   guidance.interpretation (IntentInterpretation)
 *     → Present when mode === "guide" AND vague intent was classified
 *     → Describes what the user appears to be TRYING TO DO
 *     → Produced by Intent Interpretation Bridge (understand/intent-interpretation/)
 *
 *   interpretation (InterpretationResult)
 *     → Present when mode === "execute" AND input is a structured change command
 *     → Describes what the change MEANS (impact, confidence, category)
 *     → Produced by Change Interpretation (understand/interpretation/)
 *
 * ── Guide mode contract ───────────────────────────────────────────────────────
 *
 *   When mode === "guide", IntakeResult MUST carry `guidance`.
 *   No consumer should need to recompute completion to get next steps.
 */
export {};
//# sourceMappingURL=types.js.map