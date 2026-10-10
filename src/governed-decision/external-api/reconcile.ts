/**
 * Reconciliation — the pure, deterministic, model-independent core.
 *
 * Inputs:  executor invocation evidence + observer reality evidence.
 * Output:  verdict + the two spine dimensions + feedsNextCycle.
 *
 * No LLM, no clock, no IO, no credential material. The same two evidence
 * objects always produce the same reconciliation.
 *
 * The mapping (section 12 gates in algebraic form):
 *
 *   realityVerdict = "disagree"                      → CONTRADICTED
 *   realityVerdict = "unknown"                       → UNRESOLVED
 *   agree + intendedVsActual = "match"               → VERIFIED_SUCCESS
 *   agree + intendedVsActual = "deviation"           → REALITY_CONFIRMED_EXECUTION_UNCONFIRMED
 *
 * No-actuation paths (the pre-observation gate fired) carry their own
 * verdicts: ALREADY_SATISFIED / PRECONDITION_FAILED / UNRESOLVED.
 *
 *   feedsNextCycle = intendedVsActual === "match" && realityVerdict === "agree"
 *
 * — the corrected spine rule. Unknown reality NEVER feeds the next cycle as
 * a verified basis. REALITY_CONFIRMED_EXECUTION_UNCONFIRMED does not feed:
 * reality agrees, but the executor cannot confirm it performed the write, so
 * the observation is not a verified basis for the next cycle.
 */

import type {
  ApiWriteBinding,
  ApiWriteExecutionEvidence,
  ApiObservation,
  ApiWriteInvocation,
  ApiWriteReconciliation,
} from "./types.js";

type AttemptedOperation = NonNullable<ApiWriteExecutionEvidence["operation"]>;

function operationMatchesBinding(op: AttemptedOperation, binding: ApiWriteBinding): boolean {
  return (
    op.table === binding.table &&
    op.rowId === binding.rowId &&
    op.set.field === binding.expectedTargetValue &&
    op.set.revision === binding.expectedNextRevision &&
    op.predicate.rowId === binding.rowId &&
    op.predicate.revision === binding.expectedPriorRevision
  );
}

/**
 * Executor-vantage execution fidelity, derived from RAW evidence (never from
 * an executor-supplied verdict field — a self-certification payload carries
 * no authority here).
 *
 *   "match"     — the bound operation was attempted exactly once AND
 *                 acknowledged (ack_success).
 *   "deviation" — no actuation, operation mismatch, ack_refused, ack_error,
 *                 or ack_lost. Note the deliberate asymmetry: a lost response
 *                 is a DEVIATION in execution fidelity even when reality later
 *                 confirms the write landed — the executor's vantage genuinely
 *                 cannot confirm its own execution. Both dimensions are
 *                 preserved, never collapsed.
 */
export function deriveIntendedVsActual(
  binding: ApiWriteBinding,
  operation: AttemptedOperation | null,
  attempts: readonly ApiWriteInvocation[],
): "match" | "deviation" {
  if (operation === null) return "deviation";
  if (!operationMatchesBinding(operation, binding)) return "deviation";
  if (attempts.length !== 1) return "deviation";
  return attempts[0]?.ack === "ack_success" ? "match" : "deviation";
}

export function reconcileApiWrite(
  execution: ApiWriteExecutionEvidence,
  observation: ApiObservation,
): ApiWriteReconciliation {
  const { intendedVsActual } = execution;
  const { realityVerdict } = observation;
  const feedsNextCycle = intendedVsActual === "match" && realityVerdict === "agree";

  if (execution.attempts.length === 0) {
    const reason = execution.noActuationReason ?? "unknown";
    if (reason.startsWith("already-satisfied")) {
      return {
        verdict: "ALREADY_SATISFIED",
        intendedVsActual,
        realityVerdict,
        feedsNextCycle,
        rationale:
          "pre-observation showed the approved post-state already holds; no actuation attempted (idempotent no-op). Does not feed the next cycle: nothing was executed.",
      };
    }
    if (reason.startsWith("precondition-failed")) {
      return {
        verdict: "PRECONDITION_FAILED",
        intendedVsActual,
        realityVerdict,
        feedsNextCycle,
        rationale:
          "pre-observation affirmatively differed from the expected prior state; actuation aborted (fail-closed). Does not feed the next cycle.",
      };
    }
    return {
      verdict: "UNRESOLVED",
      intendedVsActual,
      realityVerdict,
      feedsNextCycle,
      rationale:
        "pre-observation could not establish the prior state; actuation aborted (never actuate blind). Uncertainty preserved.",
    };
  }

  if (realityVerdict === "disagree") {
    return {
      verdict: "CONTRADICTED",
      intendedVsActual,
      realityVerdict,
      feedsNextCycle,
      rationale:
        "independent observation affirmatively contradicts the approved state. The executor's ack — whatever it claimed — cannot override reality.",
    };
  }
  if (realityVerdict === "unknown") {
    return {
      verdict: "UNRESOLVED",
      intendedVsActual,
      realityVerdict,
      feedsNextCycle,
      rationale:
        "reality is unresolved (stale read, observer unavailability, or exhausted read budget). Uncertainty is preserved as uncertainty and never feeds the next cycle.",
    };
  }
  if (intendedVsActual === "match") {
    return {
      verdict: "VERIFIED_SUCCESS",
      intendedVsActual,
      realityVerdict,
      feedsNextCycle,
      rationale:
        "the bound operation was attempted and acknowledged, AND independent observation confirms the approved state with no collateral. Both dimensions hold.",
    };
  }
  return {
    verdict: "REALITY_CONFIRMED_EXECUTION_UNCONFIRMED",
    intendedVsActual,
    realityVerdict,
    feedsNextCycle,
    rationale:
      "independent observation confirms the approved state, but the executor cannot confirm its own execution (lost response or refused predicate). Reality is established; execution is not. Does not feed the next cycle.",
  };
}
