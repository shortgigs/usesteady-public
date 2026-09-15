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

import type { IntakeContext, IntakeResult, IntakeSignal } from "./types.js";
import type { LLMClassification }                         from "./intent-families.js";
import { classifyIntent }                                 from "./llm-classifier.js";
import type { DebugTrace } from "./trace.js";
import type { GuidancePayload } from "../understand/intent-interpretation/types.js";
import { interpretChange } from "../understand/interpretation/interpretation.js";
import { enrichGuidance } from "../understand/intent-interpretation/intent-interpretation.js";
import { applyGuidanceOrdering } from "../interaction/guidance-order.js";
import {
  selectSilentGuidanceMode,
  getSilentGuidanceSteps,
} from "../understand/silent-guidance/index.js";
import type { SilentGuidanceMode } from "../understand/silent-guidance/index.js";
import { runPRV } from "../prv/prv.js";
import { runSafetyGate } from "../safety/safety-gate.js";
import { runContextAlignment } from "../understand/context/context-alignment.js";
import { runDisambiguation } from "../understand/disambiguation/registry.js";
import { runCompletion } from "../understand/completion/completion.js";
import {
  safetyToSignal,
  contextAlignmentToSignal,
  disambiguationToSignal,
  completionToSignal,
} from "./signal-extractor.js";
import { classifyIntentState } from "./classify-intent-state.js";
import { planResponse } from "./response-planner.js";

// ─── Internal pipeline ────────────────────────────────────────────────────────

type PipelineOutput = {
  readonly result: IntakeResult;
  readonly trace:  DebugTrace;
};

function runPipeline(input: string, ctx: IntakeContext): PipelineOutput {
  // Build UnderstandContext once — passed to context-aware layers.
  const understandCtx = {
    hasPriorSession: ctx.prvContext.hasPriorSession,
    ...(ctx.prvContext.lastInput  !== undefined ? { lastInput:  ctx.prvContext.lastInput  } : {}),
    ...(ctx.prvContext.lastResult !== undefined ? { lastResult: ctx.prvContext.lastResult } : {}),
  };

  // ── Step 1: PRV ─────────────────────────────────────────────────────────────
  const prvResult = runPRV(input, ctx.prvContext);
  if (!prvResult.ok) {
    const signal: IntakeSignal = { type: "hard_mismatch", source: "context" };
    return {
      result: { mode: "clarify", reason: prvResult.reason, signal, intentState: "ambiguous" },
      trace:  {
        prvPassed:      false,
        safetyVerdict:  "not_reached",
        contextKind:    "not_reached",
        disambigKind:   "not_reached",
        completionKind: "not_reached",
        bridgeFired:    false,
      },
    };
  }

  // ── Step 2: Safety Gate ──────────────────────────────────────────────────────
  const safetyResult = runSafetyGate(input);
  const safetySignal = safetyToSignal(safetyResult);
  if (safetySignal !== null) {
    const state    = classifyIntentState(safetySignal);
    const decision = planResponse(state);
    return {
      result: {
        mode:        decision.mode,
        reason:      safetyResult.note ?? decision.reason,
        signal:      safetySignal,
        intentState: state,
      },
      trace: {
        prvPassed:      true,
        safetyVerdict:  "block",
        contextKind:    "not_reached",
        disambigKind:   "not_reached",
        completionKind: "not_reached",
        bridgeFired:    false,
      },
    };
  }

  // ── Step 3: Context Alignment ────────────────────────────────────────────────
  const contextResult = runContextAlignment(input, understandCtx);
  const contextSignal = contextAlignmentToSignal(contextResult);
  if (contextSignal !== null) {
    const state    = classifyIntentState(contextSignal);
    const decision = planResponse(state);
    return {
      result: {
        mode:        decision.mode,
        reason:      contextResult.kind === "hard_mismatch" ? contextResult.reason : decision.reason,
        signal:      contextSignal,
        intentState: state,
      },
      trace: {
        prvPassed:      true,
        safetyVerdict:  "allow",
        contextKind:    contextResult.kind,
        disambigKind:   "not_reached",
        completionKind: "not_reached",
        bridgeFired:    false,
      },
    };
  }

  // ── Step 4: Disambiguation ───────────────────────────────────────────────────
  // `unknown` → null (falls through to completion per contract).
  // `ambiguous` → short-circuit with clarify.
  // We record the kind regardless, since both clear and unknown fall through.
  const disambigResult = runDisambiguation(input);
  const disambigSignal = disambiguationToSignal(disambigResult);
  if (disambigSignal !== null) {
    const state    = classifyIntentState(disambigSignal);
    const decision = planResponse(state);
    return {
      result: {
        mode:        decision.mode,
        reason:      disambigResult.kind === "ambiguous" ? disambigResult.reason : decision.reason,
        signal:      disambigSignal,
        intentState: state,
      },
      trace: {
        prvPassed:      true,
        safetyVerdict:  "allow",
        contextKind:    "aligned",
        disambigKind:   disambigResult.kind,
        completionKind: "not_reached",
        bridgeFired:    false,
      },
    };
  }

  // Record disambig kind for the trace even when falling through.
  const tracedDisambigKind = disambigResult.kind;

  // ── Step 5: Completion — authority on executability ──────────────────────────
  // Receives full UnderstandContext so context-dependent inputs can be resolved.
  const completionResult = runCompletion(input, understandCtx);
  const completionSignal = completionToSignal(completionResult);
  const state            = classifyIntentState(completionSignal);
  const decision         = planResponse(state);

  // CONTRACT: interpretation attempted when mode === "execute" (change interpretation, advisory).
  if (completionResult.kind === "complete") {
    const interpretation = interpretChange(input) ?? undefined;
    const result: IntakeResult = {
      mode:        decision.mode,
      reason:      decision.reason,
      signal:      completionSignal,
      intentState: state,
    };
    return {
      result: interpretation !== undefined ? { ...result, interpretation } : result,
      trace:  {
        prvPassed:      true,
        safetyVerdict:  "allow",
        contextKind:    "aligned",
        disambigKind:   tracedDisambigKind,
        completionKind: "complete",
        bridgeFired:    false,
      },
    };
  }

  // CONTRACT: guidance present iff mode === "guide".
  //
  // For guided_recovery: run the Intent Interpretation Bridge to enrich guidance
  // with intent classification and context-aware step labels.
  //
  // For incomplete: intent is already unambiguous (e.g. commit missing message).
  // Bridge does not run — guidance is already specific, no interpretation needed.
  //
  // enrichGuidance returns null for non-guided_recovery, so the ?? fallback
  // handles incomplete cleanly without branching.
  const enrichedGuidance: GuidancePayload =
    enrichGuidance(input, completionResult, understandCtx) ?? {
      missing:   completionResult.missing,
      nextSteps: completionResult.nextSteps,
    };

  // bridgeFired: bridge ran (guided_recovery OR incomplete) AND produced a classification.
  // Both completion kinds lead to guide mode; both are eligible for bridge enrichment.
  const bridgeEligible =
    completionResult.kind === "guided_recovery" || completionResult.kind === "incomplete";
  const bridgeFired =
    bridgeEligible && enrichedGuidance.interpretation !== undefined;

  // bridgeSilenceReason: set only when the bridge was eligible but no interpreter
  // claimed the input. This is the observable runtime fact — it does not explain
  // WHY no interpreter claimed it (that requires the formal human gate evaluation).
  const bridgeSilenceReason: "no_interpreter_claimed" | undefined =
    bridgeEligible && !bridgeFired ? "no_interpreter_claimed" : undefined;

  // Phase 4C — Silent Guidance Mode (presentation-level template selection).
  //
  // For bridge-silent flows only, inspect the raw input for shape-level signals
  // and replace the default code-patch nextSteps with mode-appropriate steps.
  //
  // CONTRACTS (non-negotiable):
  //   - Only runs when bridgeSilenceReason === "no_interpreter_claimed"
  //   - Does NOT produce a category, confidence, or interpretation
  //   - Does NOT affect mode, signal, intentState, or missing[]
  //   - Does NOT enter UCP envelopes
  //   - Does NOT imply executability
  //   - missing[] is always preserved unchanged
  //   - interpretation is always preserved unchanged (undefined for silent flows)
  const silentGuidanceMode: SilentGuidanceMode | undefined =
    bridgeSilenceReason === "no_interpreter_claimed"
      ? selectSilentGuidanceMode(input)
      : undefined;

  const postBridgeGuidance: GuidancePayload =
    silentGuidanceMode !== undefined
      ? {
          missing:          enrichedGuidance.missing,
          nextSteps:        getSilentGuidanceSteps(silentGuidanceMode),
          silentGuidanceMode,
          // interpretation is undefined for silent flows; spread only if present
          ...(enrichedGuidance.interpretation !== undefined
            ? { interpretation: enrichedGuidance.interpretation }
            : {}),
        }
      : enrichedGuidance;

  // B2 — Session-aware guidance ordering (purely presentational).
  // Reorders steps (read_first first) and adjusts read_first label emphasis
  // when the user is familiar with the current guidance category
  // (FAMILIARITY_THRESHOLD observations of that category).
  //
  // CONTRACTS:
  //   - Step count never changes (no add, no remove)
  //   - missing[] never changes
  //   - interpretation never changes
  //   - mode, reason, intentState are already decided — this cannot affect them
  const guidance = applyGuidanceOrdering(
    postBridgeGuidance,
    ctx.interactionContract.observedIntentPatterns,
  );

  return {
    result: {
      mode:        decision.mode,
      reason:      completionResult.reason,
      signal:      completionSignal,
      intentState: state,
      guidance,
    },
    trace: {
      prvPassed:      true,
      safetyVerdict:  "allow",
      contextKind:    "aligned",
      disambigKind:   tracedDisambigKind,
      completionKind: completionResult.kind,
      bridgeFired,
      ...(bridgeSilenceReason !== undefined ? { bridgeSilenceReason } : {}),
      ...(silentGuidanceMode  !== undefined ? { silentGuidanceMode  } : {}),
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the intake pipeline and return the result.
 * Trace is computed internally but discarded.
 * Use for all production code paths.
 */
export function runIntake(input: string, ctx: IntakeContext): IntakeResult {
  return runPipeline(input, ctx).result;
}

/**
 * Run the intake pipeline and return both the result and the debug trace.
 * Use for observability, debugging, and developer tooling only.
 *
 * CONTRACT: DebugTrace is zero-authority.
 * It records what happened; it changes nothing.
 * Any code that reads DebugTrace to make a decision is wrong.
 */
export function runIntakeWithTrace(
  input: string,
  ctx: IntakeContext,
): { result: IntakeResult; trace: DebugTrace } {
  return runPipeline(input, ctx);
}

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
export async function runIntakeWithLLM(
  input: string,
  ctx:   IntakeContext,
): Promise<IntakeResult> {
  const result = runPipeline(input, ctx).result;

  // Only enrich when in guide mode and the bridge was silent.
  const isBridgeSilent =
    result.mode === "guide" &&
    result.guidance !== undefined &&
    result.guidance.interpretation === undefined;

  if (!isBridgeSilent) return result;

  const llmResult: LLMClassification | null = await classifyIntent(input);
  if (llmResult === null) return result;

  return {
    ...result,
    guidance: {
      ...result.guidance!,
      llmClassification: llmResult,
    },
  };
}

// ─── UCP Pipeline Tap ─────────────────────────────────────────────────────────

import type {
  IntentEnvelope,
  PRVEnvelope,
  SafetyEnvelope,
  ContextAlignmentEnvelope,
  DisambiguationEnvelope,
  CompletionEnvelope,
  IntentInterpretationEnvelope,
  ChangeInterpretationEnvelope,
  ResponseEnvelope,
  DebugTraceEnvelope,
} from "../ucp/types.js";
import { mapIntentToEnvelope }              from "../ucp/mappers/map-intent.js";
import { mapPRVToEnvelope }                 from "../ucp/mappers/map-prv.js";
import { mapSafetyToEnvelope }              from "../ucp/mappers/map-safety.js";
import { mapContextToEnvelope }             from "../ucp/mappers/map-context.js";
import { mapDisambiguationToEnvelope }      from "../ucp/mappers/map-disambiguation.js";
import { mapCompletionToEnvelope }          from "../ucp/mappers/map-completion.js";
import { mapIntentInterpretationToEnvelope } from "../ucp/mappers/map-intent-interpretation.js";
import { mapChangeInterpretationToEnvelope } from "../ucp/mappers/map-change-interpretation.js";
import { mapResponseToEnvelope }            from "../ucp/mappers/map-response.js";
import { mapDebugTraceToEnvelope }          from "../ucp/mappers/map-debug-trace.js";

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
  readonly intent:               IntentEnvelope;
  readonly prv?:                 PRVEnvelope;
  readonly safety?:              SafetyEnvelope;
  readonly context?:             ContextAlignmentEnvelope;
  readonly disambiguation?:      DisambiguationEnvelope;
  readonly completion?:          CompletionEnvelope;
  readonly intentInterpretation?: IntentInterpretationEnvelope;
  readonly changeInterpretation?: ChangeInterpretationEnvelope;
  readonly response:             ResponseEnvelope;
  readonly debugTrace:           DebugTraceEnvelope;
};

export type RunIntakeWithUCPResult = {
  readonly result: IntakeResult;
  readonly trace:  DebugTrace;
  readonly ucp:    UCPBundle;
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
export function runIntakeWithUCP(
  input: string,
  ctx: IntakeContext,
): RunIntakeWithUCPResult {
  // Step 0: Run the authoritative pipeline. This is the source of truth.
  const { result, trace } = runPipeline(input, ctx);

  // Intent envelope is always present — the raw input is always captured.
  const intentEnvelope = mapIntentToEnvelope(input);

  // Build UnderstandContext (mirrors the pipeline's internal construction).
  const understandCtx = {
    hasPriorSession: ctx.prvContext.hasPriorSession,
    ...(ctx.prvContext.lastInput  !== undefined ? { lastInput:  ctx.prvContext.lastInput  } : {}),
    ...(ctx.prvContext.lastResult !== undefined ? { lastResult: ctx.prvContext.lastResult } : {}),
  };

  // ── Step 1: PRV ────────────────────────────────────────────────────────────
  const prvResult    = runPRV(input, ctx.prvContext);
  const prvEnvelope  = mapPRVToEnvelope(prvResult);

  // Response refs: parentId + rootId always point to the intent envelope.
  // This makes the response linkable via byParent and byRoot in the query layer.
  const responseRefs = { parentId: intentEnvelope.id, rootId: intentEnvelope.id };

  if (!prvResult.ok) {
    // Pipeline short-circuited at PRV. Only intent + prv + response + trace.
    return {
      result,
      trace,
      ucp: {
        intent:     intentEnvelope,
        prv:        prvEnvelope,
        response:   mapResponseToEnvelope(result, responseRefs),
        debugTrace: mapDebugTraceToEnvelope(trace),
      },
    };
  }

  // ── Step 2: Safety Gate ────────────────────────────────────────────────────
  const safetyResult   = runSafetyGate(input);
  const safetyEnvelope = mapSafetyToEnvelope(safetyResult);

  if (safetyResult.verdict === "block") {
    return {
      result,
      trace,
      ucp: {
        intent:     intentEnvelope,
        prv:        prvEnvelope,
        safety:     safetyEnvelope,
        response:   mapResponseToEnvelope(result, responseRefs),
        debugTrace: mapDebugTraceToEnvelope(trace),
      },
    };
  }

  // ── Step 3: Context Alignment ──────────────────────────────────────────────
  const contextResult   = runContextAlignment(input, understandCtx);
  const contextEnvelope = mapContextToEnvelope(contextResult);

  if (contextResult.kind !== "aligned") {
    return {
      result,
      trace,
      ucp: {
        intent:     intentEnvelope,
        prv:        prvEnvelope,
        safety:     safetyEnvelope,
        context:    contextEnvelope,
        response:   mapResponseToEnvelope(result, responseRefs),
        debugTrace: mapDebugTraceToEnvelope(trace),
      },
    };
  }

  // ── Step 4: Disambiguation ─────────────────────────────────────────────────
  const disambigResult   = runDisambiguation(input);
  const disambigEnvelope = mapDisambiguationToEnvelope(disambigResult);

  if (disambigResult.kind === "ambiguous") {
    return {
      result,
      trace,
      ucp: {
        intent:         intentEnvelope,
        prv:            prvEnvelope,
        safety:         safetyEnvelope,
        context:        contextEnvelope,
        disambiguation: disambigEnvelope,
        response:       mapResponseToEnvelope(result, responseRefs),
        debugTrace:     mapDebugTraceToEnvelope(trace),
      },
    };
  }

  // ── Step 5: Completion ─────────────────────────────────────────────────────
  const completionResult   = runCompletion(input, understandCtx);
  const completionEnvelope = mapCompletionToEnvelope(completionResult);

  // ── Interpretation envelopes (advisory, present only when applicable) ──────
  const changeInterpEnvelope =
    result.interpretation !== undefined
      ? mapChangeInterpretationToEnvelope(result.interpretation)
      : undefined;

  const intentInterpEnvelope =
    result.guidance?.interpretation !== undefined
      ? mapIntentInterpretationToEnvelope(result.guidance.interpretation)
      : undefined;

  return {
    result,
    trace,
    ucp: {
      intent:                                intentEnvelope,
      prv:                                   prvEnvelope,
      safety:                                safetyEnvelope,
      context:                               contextEnvelope,
      disambiguation:                        disambigEnvelope,
      completion:                            completionEnvelope,
      ...(intentInterpEnvelope  !== undefined ? { intentInterpretation:  intentInterpEnvelope  } : {}),
      ...(changeInterpEnvelope  !== undefined ? { changeInterpretation:  changeInterpEnvelope  } : {}),
      response:   mapResponseToEnvelope(result, responseRefs),
      debugTrace: mapDebugTraceToEnvelope(trace),
    },
  };
}
