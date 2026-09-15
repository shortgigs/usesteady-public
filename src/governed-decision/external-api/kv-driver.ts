/**
 * KV certification driver — orchestrates one governed external write:
 *
 *   1. VALIDATE the binding (monotonic self-managed revision) and the
 *      credential classes (structural authority separation).
 *   2. PRE-OBSERVE via the observer (fail-closed gate, snapshot semantics):
 *        - bound prior state holds         → proceed to actuation
 *        - post-state already holds        → ALREADY_SATISFIED, no actuation
 *        - affirmatively different         → PRECONDITION_FAILED, no actuation
 *        - unresolved (incl. key-absent,   → UNRESOLVED, no actuation
 *          stale-explainable, unavailable)
 *      The driver NEVER actuates blind.
 *   3. ACTUATE via the executor — exactly one UNCONDITIONAL PUT.
 *   4. OBSERVE via the observer under the bounded convergence policy.
 *   5. RECONCILE (pure) → verdict + feedsNextCycle.
 *   6. EVIDENCE — a replayable record containing credential CLASSES (never
 *      values), HTTP outcome classifications (never raw payloads), every
 *      read/write attempt with timestamps, the collateral delta, and a
 *      content hash.
 *
 * ── NO-CAS CAVEAT (load-bearing) ─────────────────────────────────────────────
 *
 *   Actuation is UNCONDITIONAL: KV evaluates no predicate, so the pre-
 *   observation gate is CHECK-THEN-ACT, not atomic check-and-act. A competing
 *   write that lands between pre-observation and our PUT is silently
 *   overwritten (last-write-wins) and may leave NO trace in this record —
 *   detection is limited to states the observer actually reads. This driver
 *   certifies the observed transition only; it never claims concurrency
 *   prevention, and the self-managed revision envelope is an observation aid,
 *   not a concurrency guard.
 *
 * One invocation = one attempt. There is no executor-side retry: a retry is
 * a separate governed invocation with a fresh binding (which is how the
 * duplicate-invocation case becomes ALREADY_SATISFIED rather than an error).
 * A stale-prior duplicate re-actuates an idempotent same-value PUT — a
 * harmless no-op in effect: the revision does not advance and the record
 * truthfully shows the re-applied identical envelope.
 */

import { hashObject } from "../../ucp/hashes.js";
import { executeKvScratchWrite } from "./kv-executor.js";
import {
  DEFAULT_KV_READ_POLICY,
  observeKvScratchValue,
  type KvReadPolicy,
} from "./kv-observer.js";
import type { FetchLike } from "./kv.js";
import { deriveKvIntendedVsActual, reconcileKvWrite } from "./kv-reconcile.js";
import type {
  KvCredential,
  KvObservation,
  KvWriteBinding,
  KvWriteEvidenceRecord,
  KvWriteExecutionEvidence,
} from "./kv-types.js";

export type KvCertDriverDeps = {
  readonly fetchImpl?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly policy?: KvReadPolicy;
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

function noActuationEvidence(reason: string, detail: string): KvWriteExecutionEvidence {
  return {
    executorClass: "executor_kv_edit",
    operation: null,
    attempts: [],
    intendedVsActual: "deviation",
    noActuationReason: reason,
    detail,
  };
}

export async function runKvScratchCertification(
  binding: KvWriteBinding,
  creds: { executor: KvCredential; observer: KvCredential },
  deps: KvCertDriverDeps = {},
): Promise<KvWriteEvidenceRecord> {
  if (binding.expectedNextRevision !== binding.expectedPriorRevision + 1) {
    throw new Error(
      `binding revision must be monotonic (prior ${binding.expectedPriorRevision} -> next ${binding.expectedNextRevision})`,
    );
  }
  if (creds.executor.class !== "executor_kv_edit") {
    throw new Error("executor credential must be executor_kv_edit");
  }
  if (creds.observer.class !== "observer_kv_read") {
    throw new Error("observer credential must be observer_kv_read");
  }

  const fetchImpl = deps.fetchImpl ?? defaultFetchImpl;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const policy = deps.policy ?? DEFAULT_KV_READ_POLICY;

  // ── Pre-observation gate (fail-closed, snapshot semantics) ────────────────
  const preObservation = await observeKvScratchValue(
    binding,
    creds.observer,
    fetchImpl,
    now,
    sleep,
    policy,
    "snapshot",
  );

  const sawExactPrior =
    preObservation.finalEnvelope !== null &&
    preObservation.finalEnvelope.field === binding.expectedPriorValue &&
    preObservation.finalEnvelope.revision === binding.expectedPriorRevision &&
    preObservation.finalEnvelope.note === binding.expectedWitnessValue;

  let execution: KvWriteExecutionEvidence;
  let observation: KvObservation;

  if (sawExactPrior) {
    // ── Actuation (only when the pre-observation confirmed the prior state) ──
    const { operation, attempts } = await executeKvScratchWrite(
      binding,
      creds.executor,
      fetchImpl,
      now,
    );
    observation = await observeKvScratchValue(
      binding,
      creds.observer,
      fetchImpl,
      now,
      sleep,
      policy,
    );
    execution = {
      executorClass: "executor_kv_edit",
      operation,
      attempts,
      intendedVsActual: deriveKvIntendedVsActual(binding, operation, attempts),
      detail:
        "one UNCONDITIONAL set-to-value PUT attempted (no CAS — check-then-act only); ack classified as invocation evidence only",
    };
  } else if (preObservation.realityVerdict === "unknown") {
    execution = noActuationEvidence(
      "precondition-unresolved",
      "pre-observation could not establish the prior state (unavailable, key-absent, or only stale-explainable reads) — never actuate blind",
    );
    observation = preObservation;
  } else if (preObservation.realityVerdict === "agree") {
    execution = noActuationEvidence(
      "already-satisfied",
      "pre-observation showed the approved post-state already holds — idempotent no-op",
    );
    observation = preObservation;
  } else if (
    preObservation.finalEnvelope !== null &&
    preObservation.finalEnvelope.field === binding.expectedTargetValue &&
    preObservation.finalEnvelope.revision === binding.expectedNextRevision
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

  const reconciliation = reconcileKvWrite(execution, observation);

  const recordBody = {
    artifact: "USESTEADY_EVENTUALLY_CONSISTENT_KV_CERTIFICATION_V1" as const,
    authoritySource:
      "operator_authorization_2026-08-07_eventually_consistent_kv_certification_v1" as const,
    binding,
    execution,
    observation,
    reconciliation,
  };
  return { ...recordBody, contentHash: hashObject(recordBody) };
}
