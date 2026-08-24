/**
 * Intake Service — the full Signal → Gate spine of UseSteady.
 *
 * Pipeline order (non-negotiable):
 *   1. PRV              — lexical context-dependency check
 *   2. Safety Gate      — unsafe inputs blocked here; never reach understanding
 *   3. Context Alignment — semantic: social/mismatch classification
 *   4. Disambiguation   — ambiguous term detection; unknown falls through
 *   5. Completion       — executability authority, receives full context
 *   6. Classify intent state
 *   7. Plan response
 *
 * ── Public API ────────────────────────────────────────────────────────────────
 *
 *   runIntake(input, ctx)            → IntakeResult        (production use)
 *   runIntakeWithTrace(input, ctx)   → { result, trace }   (observability / debug)
 *
 * Both call the same internal runPipeline. runIntake discards the trace.
 * DebugTrace is zero-authority: it never affects the result.
 *
 * ── Contracts ──────────────────────────────────────────────────────────────────
 *
 *   CONTRACT 1: execute is only reachable via complete (step 5).
 *               No other path produces execute.
 *
 *   CONTRACT 2: Completion receives UnderstandContext.
 *               Context-dependent inputs ("run again") are resolvable in step 5.
 *
 *   CONTRACT 3: guidance is present if and only if mode === "guide".
 *               No consumer re-runs completion to get next steps.
 *
 *   CONTRACT 4: PRV is lexical, Context Alignment is semantic.
 *               No broad semantic reasoning in PRV.
 *
 *   CONTRACT 5: Public result exposes final outcome, not internal intermediates.
 *               disambiguation `unknown` is not returned as a signal.
 */
import type { IntakeContext, IntakeResult } from "./types.js";
import type { DebugTrace } from "./trace.js";
/**
 * Run the intake pipeline and return the result.
 * Trace is computed internally but discarded.
 * Use for all production code paths.
 */
export declare function runIntake(input: string, ctx: IntakeContext): IntakeResult;
/**
 * Run the intake pipeline and return both the result and the debug trace.
 * Use for observability, debugging, and developer tooling only.
 *
 * CONTRACT: DebugTrace is zero-authority.
 * It records what happened; it changes nothing.
 * Any code that reads DebugTrace to make a decision is wrong.
 */
export declare function runIntakeWithTrace(input: string, ctx: IntakeContext): {
    result: IntakeResult;
    trace: DebugTrace;
};
/**
 * Async variant of runIntake that enriches guide-mode results with LLM
 * classification when the Intent Interpretation Bridge produced no interpretation.
 *
 * ── When LLM classification runs ─────────────────────────────────────────────
 *
 *   Observable proxy for bridge-silence:
 *     result.mode === "guide"
 *     AND result.guidance is present
 *     AND result.guidance.interpretation is undefined
 *
 *   This corresponds exactly to bridgeSilenceReason === "no_interpreter_claimed"
 *   inside the pipeline — the bridge ran but no interpreter claimed the input.
 *
 * ── Guarantees ───────────────────────────────────────────────────────────────
 *
 *   - Returns the synchronous result unchanged if mode !== "guide".
 *   - Returns the synchronous result unchanged if the bridge already fired.
 *   - Returns the synchronous result unchanged if the LLM call returns null.
 *   - llmClassification is advisory only: mode, signal, intentState, missing[]
 *     are never modified by this function.
 *
 * Use for the single-session CLI cursor mode where async is available.
 * The synchronous runIntake remains unchanged for tests and other consumers.
 */
export declare function runIntakeWithLLM(input: string, ctx: IntakeContext): Promise<IntakeResult>;
import type { IntentEnvelope, PRVEnvelope, SafetyEnvelope, ContextAlignmentEnvelope, DisambiguationEnvelope, CompletionEnvelope, IntentInterpretationEnvelope, ChangeInterpretationEnvelope, ResponseEnvelope, DebugTraceEnvelope } from "../ucp/types.js";
/**
 * UCP bundle — all envelopes produced during one intake run.
 *
 * Optional fields are absent when the pipeline short-circuited before
 * that step ran.  `intent` and `response` and `debugTrace` are always present.
 *
 * Ownership contract:
 *   - Envelopes are read-only views of pipeline outputs.
 *   - No envelope may mutate the pipeline.
 *   - Consumers must read `response.payload.mode` — never derive decisions
 *     from other envelopes.
 */
export type UCPBundle = {
    readonly intent: IntentEnvelope;
    readonly prv?: PRVEnvelope;
    readonly safety?: SafetyEnvelope;
    readonly context?: ContextAlignmentEnvelope;
    readonly disambiguation?: DisambiguationEnvelope;
    readonly completion?: CompletionEnvelope;
    readonly intentInterpretation?: IntentInterpretationEnvelope;
    readonly changeInterpretation?: ChangeInterpretationEnvelope;
    readonly response: ResponseEnvelope;
    readonly debugTrace: DebugTraceEnvelope;
};
export type RunIntakeWithUCPResult = {
    readonly result: IntakeResult;
    readonly trace: DebugTrace;
    readonly ucp: UCPBundle;
};
/**
 * Run the intake pipeline and return the full result, debug trace, AND a UCP bundle.
 *
 * CONTRACT:
 *   - The authoritative result comes from runIntakeWithTrace (unchanged).
 *   - UCP envelopes are built by re-running each pure pipeline step to obtain
 *     exact native types for mapper fidelity.
 *   - Re-running pure steps is safe because all steps are deterministic functions.
 *   - The pipeline short-circuit logic is mirrored: envelopes are only created
 *     for steps that ran.
 *   - runIntakeWithUCP.result === runIntakeWithTrace.result for the same inputs.
 *   - UCP presence does NOT affect mode, guidance, safety, or any decision.
 *
 * DO NOT use the ucp bundle for routing or decision-making.
 * Mode is the only handoff authority — and mode lives in result.mode.
 */
export declare function runIntakeWithUCP(input: string, ctx: IntakeContext): RunIntakeWithUCPResult;
//# sourceMappingURL=intake-service.d.ts.map