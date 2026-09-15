/**
 * Certification driver — orchestrates one governed external write:
 *
 *   1. VALIDATE the binding (monotonic revision) and the credential classes
 *      (structural authority separation).
 *   2. PRE-OBSERVE via the observer (fail-closed gate):
 *        - prior state holds            → proceed to actuation
 *        - post-state already holds     → ALREADY_SATISFIED, no actuation
 *        - affirmatively different      → PRECONDITION_FAILED, no actuation
 *        - unresolved                   → UNRESOLVED, no actuation
 *      The driver NEVER actuates blind.
 *   3. ACTUATE via the executor — exactly one atomic conditional write.
 *   4. OBSERVE via the observer under the bounded convergence policy.
 *   5. RECONCILE (pure) → verdict + feedsNextCycle.
 *   6. EVIDENCE — a replayable record containing credential CLASSES (never
 *      values), HTTP outcome classifications (never raw payloads), every
 *      read/write attempt with timestamps, the observation scope, the
 *      collateral delta, and a content hash.
 *
 * One invocation = one attempt. There is no executor-side retry: a retry is
 * a separate governed invocation with a fresh binding (which is how case I —
 * duplicate invocation — becomes ALREADY_SATISFIED rather than an error).
 */

import { hashObject } from "../../ucp/hashes.js";
import { executeSupabaseScratchWrite } from "./executor.js";
import { DEFAULT_READ_POLICY, observeSupabaseScratchRow, type ApiReadPolicy } from "./observer.js";
import type { FetchLike } from "./postgrest.js";
import { deriveIntendedVsActual, reconcileApiWrite } from "./reconcile.js";
import type {
  ApiCredential,
  ApiObservation,
  ApiWriteBinding,
  ApiWriteEvidenceRecord,
  ApiWriteExecutionEvidence,
} from "./types.js";

export type SupabaseCertDriverDeps = {
  readonly fetchImpl?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly policy?: ApiReadPolicy;
};

const defaultFetchImpl: FetchLike = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return { status: res.status, bodyText: await res.text() };
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function noActuationEvidence(
  reason: string,
  detail: string,
): ApiWriteExecutionEvidence {
  return {
    executorClass: "executor_service_role",
    operation: null,
    attempts: [],
    intendedVsActual: "deviation",
    noActuationReason: reason,
    detail,
  };
}

export async function runSupabaseScratchCertification(
  binding: ApiWriteBinding,
  creds: { executor: ApiCredential; observer: ApiCredential },
  deps: SupabaseCertDriverDeps = {},
): Promise<ApiWriteEvidenceRecord> {
  if (binding.expectedNextRevision !== binding.expectedPriorRevision + 1) {
    throw new Error(
      `binding revision must be monotonic (prior ${binding.expectedPriorRevision} -> next ${binding.expectedNextRevision})`,
    );
  }
  if (creds.executor.class !== "executor_service_role") {
    throw new Error("executor credential must be executor_service_role");
  }
  if (creds.observer.class !== "observer_anon") {
    throw new Error("observer credential must be observer_anon");
  }

  const fetchImpl = deps.fetchImpl ?? defaultFetchImpl;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const policy = deps.policy ?? DEFAULT_READ_POLICY;

  // ── Pre-observation gate (fail-closed, snapshot semantics) ────────────────
  const preObservation = await observeSupabaseScratchRow(
    binding,
    creds.observer,
    fetchImpl,
    now,
    sleep,
    policy,
    "snapshot",
  );

  const sawExactPrior =
    preObservation.finalRow !== null &&
    preObservation.finalRow.field === binding.expectedPriorValue &&
    preObservation.finalRow.revision === binding.expectedPriorRevision &&
    preObservation.finalRow.note === binding.expectedWitnessValue;

  let execution: ApiWriteExecutionEvidence;
  let observation: ApiObservation;

  if (sawExactPrior) {
    // ── Actuation (only when the pre-observation confirmed the prior state) ──
    const { operation, attempts } = await executeSupabaseScratchWrite(
      binding,
      creds.executor,
      fetchImpl,
      now,
    );
    observation = await observeSupabaseScratchRow(
      binding,
      creds.observer,
      fetchImpl,
      now,
      sleep,
      policy,
    );
    execution = {
      executorClass: "executor_service_role",
      operation,
      attempts,
      intendedVsActual: deriveIntendedVsActual(binding, operation, attempts),
      detail:
        "one atomic conditional set-to-value attempted; ack classified as invocation evidence only",
    };
  } else if (preObservation.realityVerdict === "unknown") {
    execution = noActuationEvidence(
      "precondition-unresolved",
      "pre-observation could not establish the prior state — never actuate blind",
    );
    observation = preObservation;
  } else if (preObservation.realityVerdict === "agree") {
    execution = noActuationEvidence(
      "already-satisfied",
      "pre-observation showed the approved post-state already holds — idempotent no-op",
    );
    observation = preObservation;
  } else if (
    preObservation.finalRow !== null &&
    preObservation.finalRow.field === binding.expectedTargetValue &&
    preObservation.finalRow.revision === binding.expectedNextRevision
  ) {
    execution = noActuationEvidence(
      "precondition-failed",
      "pre-observation showed the post value+revision with a mutated witness — collateral present before actuation",
    );
    observation = preObservation;
  } else {
    execution = noActuationEvidence(
      "precondition-failed",
      "pre-observation affirmatively differed from the expected prior state",
    );
    observation = preObservation;
  }

  const reconciliation = reconcileApiWrite(execution, observation);

  const recordBody = {
    artifact: "USESTEADY_EXTERNAL_API_WRITE_CERTIFICATION_V1" as const,
    authoritySource: "operator_authorization_section_1_to_12" as const,
    binding,
    execution,
    observation,
    reconciliation,
  };
  return { ...recordBody, contentHash: hashObject(recordBody) };
}
