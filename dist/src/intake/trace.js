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
export {};
//# sourceMappingURL=trace.js.map