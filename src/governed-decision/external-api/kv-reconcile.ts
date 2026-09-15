/**
 * KV reconciliation — the certified verdict algebra of reconcile.ts,
 * preserved EXACTLY over the KV evidence types.
 *
 * Inputs:  executor invocation evidence + observer reality evidence.
 * Output:  verdict + the two spine dimensions + feedsNextCycle.
 *
 * No LLM, no clock, no IO, no credential material. The same two evidence
 * objects always produce the same reconciliation.
 *
 * Why a parallel implementation instead of reusing reconcileApiWrite
 * directly: the Supabase evidence types pin the credential-class literals
 * ("executor_service_role" / "observer_anon") and the invocation shape
 * (rowsReturned, ack_refused) to that substrate. The KV ack-class set has NO
 * ack_refused (the type-level signature of the lost CAS) and the credential
 * classes differ by surface, so the types do not fit cleanly. Per the
 * authorization this is the sanctioned minimal adaptation: a KV-specific
 * binding type + this thin reconcile over KV types. The ALGEBRA is not
 * adapted — it is identical:
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
 * — the corrected spine rule, with NO KV-specific exception. Unknown reality
 * NEVER feeds the next cycle as a verified basis.
 * REALITY_CONFIRMED_EXECUTION_UNCONFIRMED does not feed: reality agrees, but
 * the executor cannot confirm it performed the write.
 *
 * Equivalence with reconcileApiWrite is pinned by a conformance test
 * (tests/governed-decision/kv-write-reconcile.test.ts) that runs parallel
 * evidence through both reconcilers and asserts identical verdicts across
 * the matrix.
 */

import type {
  KvObservation,
  KvWriteBinding,
  KvWriteExecutionEvidence,
  KvWriteInvocation,
} from "./kv-types.js";
import type { ApiWriteReconciliation } from "./types.js";

type AttemptedOperation = NonNullable<KvWriteExecutionEvidence["operation"]>;

function operationMatchesBinding(op: AttemptedOperation, binding: KvWriteBinding): boolean {
  return (
    op.namespaceId === binding.namespaceId &&
    op.key === binding.key &&
    op.set.field === binding.expectedTargetValue &&
    op.set.revision === binding.expectedNextRevision &&
    op.unconditional === true
  );
}

/**
 * Executor-vantage execution fidelity, derived from RAW evidence (never from
 * an executor-supplied verdict field — a self-certification payload carries
 * no authority here).
 *
 *   "match"     — the bound operation was attempted exactly once AND
 *                 acknowledged (ack_success).
 *   "deviation" — no actuation, operation mismatch, ack_error, or ack_lost.
 *                 The deliberate asymmetry is preserved: a lost response is a
 *                 DEVIATION in execution fidelity even when reality later
 *                 confirms the write landed. Both dimensions are preserved,
 *                 never collapsed.
 */
export function deriveKvIntendedVsActual(
  binding: KvWriteBinding,
  operation: AttemptedOperation | null,
  attempts: readonly KvWriteInvocation[],
): "match" | "deviation" {
  if (operation === null) return "deviation";
  if (!operationMatchesBinding(operation, binding)) return "deviation";
  if (attempts.length !== 1) return "deviation";
  return attempts[0]?.ack === "ack_success" ? "match" : "deviation";
}

export function reconcileKvWrite(
  execution: KvWriteExecutionEvidence,
  observation: KvObservation,
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
        "reality is unresolved (stale-explainable read, key-absence, observer unavailability, or exhausted read budget). Uncertainty is preserved as uncertainty and never feeds the next cycle.",
    };
  }
  if (intendedVsActual === "match") {
    return {
      verdict: "VERIFIED_SUCCESS",
      intendedVsActual,
      realityVerdict,
      feedsNextCycle,
      rationale:
        "the bound operation was attempted and acknowledged, AND independent observation confirms the approved state with no collateral. Both dimensions hold. (NO-CAS: the write was unconditional — this verdict certifies the observed transition, never concurrency prevention.)",
    };
  }
  return {
    verdict: "REALITY_CONFIRMED_EXECUTION_UNCONFIRMED",
    intendedVsActual,
    realityVerdict,
    feedsNextCycle,
    rationale:
      "independent observation confirms the approved state, but the executor cannot confirm its own execution (lost response or rejected write). Reality is established; execution is not. Does not feed the next cycle.",
  };
}
