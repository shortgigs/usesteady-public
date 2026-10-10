/**
 * Eventually-consistent KV write certification — types
 * (USESTEADY_EVENTUALLY_CONSISTENT_KV_CERTIFICATION_V1).
 *
 * The governed-decision spine's external-write certification, ported from the
 * strongly-consistent PostgREST substrate (USESTEADY_EXTERNAL_API_WRITE_CERTIFICATION_V1)
 * to an eventually-consistent key-value substrate: Cloudflare Workers KV via
 * the raw REST API. Governing invariant (unchanged):
 *
 *   A write-capable actor cannot establish the truth of its own successful
 *   execution. When independent observation cannot yet distinguish success
 *   from non-convergence, the system preserves UNKNOWN rather than inventing
 *   success or contradiction.
 *
 * ── NO-CAS CAVEAT (load-bearing — preserve exactly) ─────────────────────────
 *
 *   Cloudflare KV has NO atomic compare-and-set, NO ETag, NO per-key version.
 *   PUT is UNCONDITIONAL last-write-wins. Therefore this lane does NOT claim:
 *
 *     - atomic check-and-act;
 *     - bound-prior conditional execution;
 *     - prevention of concurrent competing writes;
 *     - proof that our write applied specifically to the observed prior
 *       revision.
 *
 *   The pre-observation gate is CHECK-THEN-ACT only. The self-managed revision
 *   field inside the value envelope distinguishes expected-post / stale-prior /
 *   competing states for the OBSERVER — it is NOT a concurrency guard and must
 *   never be described as one. Case K is a DETECTION experiment, not a
 *   concurrency-prevention certification.
 *
 * Certification resource (exactly one, isolated, reversible):
 *
 *   namespace  usesteady-kv-cert-scratch (id 80be4bfec7e244d7a03dac9a864545f0,
 *              provisioned 2026-08-07 via the Cloudflare MCP server; the
 *              account's only namespace, so account-scoped tokens are
 *              effectively namespace-scoped for this experiment — M2 reports
 *              the achievable granularity honestly)
 *   key        cert-key-1 (per-case keys in the live matrix)
 *   value      JSON envelope { field, revision, note }:
 *                field    — the governed value ("off" -> "on")
 *                revision — SELF-MANAGED logical revision (application-level
 *                           monotonic discipline; NOT a KV primitive)
 *                note     — witness field; must survive actuation untouched
 *
 * Authority separation (structural, API-token-enforced):
 *
 *   executor  executor_kv_edit  — token with Workers KV Storage Edit
 *   observer  observer_kv_read  — token with Workers KV Storage Read only;
 *                                 its write attempt is refused by the API
 *                                 (case J proves it live)
 *
 * Credential CLASSES are recorded in evidence. Token material never is.
 *
 * Spine correspondence (identical to the Supabase lane):
 *
 *   intendedVsActual  — executor-vantage execution fidelity
 *   realityVerdict    — observer-vantage reality
 *   feedsNextCycle    — intendedVsActual === "match" && realityVerdict === "agree"
 *                       (unknown NEVER feeds)
 */

import type { ApiWriteReconciliation } from "./types.js";

// ─── Credentials ─────────────────────────────────────────────────────────────

export type KvCredentialClass = "executor_kv_edit" | "observer_kv_read";

export type KvCredential = {
  /** Credential class — the ONLY property that may appear in evidence. */
  readonly class: KvCredentialClass;
  /**
   * Cloudflare API account base URL:
   * https://api.cloudflare.com/client/v4/accounts/<accountId>
   * The account id is resource identity, not a secret.
   */
  readonly url: string;
  /** API token material. NEVER logged, persisted, hashed, or in evidence. */
  readonly token: string;
};

// ─── Value envelope ──────────────────────────────────────────────────────────

/**
 * The complete value stored at the certification key. KV values are opaque
 * blobs — there is no partial projection and no partial update: a GET returns
 * the whole envelope and a PUT rewrites the whole envelope. The envelope IS
 * the complete declared observation scope; a witness-field mutation is
 * in-scope collateral.
 */
export type KvValueEnvelope = {
  /** The governed field. */
  readonly field: string;
  /**
   * Self-managed logical revision. Application-level monotonic discipline
   * only — KV does not store, check, or expose any per-key version. This
   * field lets the OBSERVER distinguish expected-post / stale-prior /
   * competing states. It is not a concurrency guard.
   */
  readonly revision: number;
  /** Witness field for collateral/anomaly detection. */
  readonly note: string;
};

// ─── Binding (the approved operation) ────────────────────────────────────────

/**
 * The bound, approved operation. Before actuation the driver binds: resource
 * identity (namespace + key), expected prior value, expected prior revision,
 * expected target value, expected next revision, and the expected witness.
 *
 * The mutation is a deterministic set-to-value of the complete envelope:
 *
 *   PUT { field: expectedTargetValue, revision: expectedNextRevision,
 *         note: expectedWitnessValue }
 *
 * UNCONDITIONALLY — there is no server-side predicate (see the NO-CAS caveat
 * in the file header).
 */
export type KvWriteBinding = {
  readonly namespaceId: string;
  readonly key: string;
  readonly expectedPriorValue: string;
  readonly expectedPriorRevision: number;
  readonly expectedTargetValue: string;
  readonly expectedNextRevision: number;
  /** The witness value that must survive actuation untouched. */
  readonly expectedWitnessValue: string;
};

/** The certification transition: field "off" -> "on" on a scratch key. */
export const KV_SCRATCH_KEY = "cert-key-1";

/**
 * The provisioned scratch namespace id. Resource identity, not a secret.
 * Provisioned 2026-08-07; the account's only namespace.
 */
export const KV_CERT_SCRATCH_NAMESPACE_ID = "80be4bfec7e244d7a03dac9a864545f0";

export function makeKvScratchBinding(
  namespaceId: string,
  key: string,
  priorRevision: number,
): KvWriteBinding {
  return {
    namespaceId,
    key,
    expectedPriorValue: "off",
    expectedPriorRevision: priorRevision,
    expectedTargetValue: "on",
    expectedNextRevision: priorRevision + 1,
    expectedWitnessValue: "witness",
  };
}

// ─── Executor-side invocation evidence (ack — never reality) ─────────────────

/**
 * The write response is invocation evidence ONLY. No ack class — including
 * ack_success — independently establishes reality.
 *
 * NOTE — the type-level signature of the lost CAS: `ack_refused` DOES NOT
 * EXIST on KV. On PostgREST a 2xx with zero rows meant "the revision
 * predicate did not hold; nothing was written". KV has no server-side
 * predicate, so there is no server-side refusal class: a 2xx always means
 * the unconditional write was accepted. The absence of ack_refused here is
 * exactly what the NO-CAS caveat means at the type level.
 */
export type KvWriteAckClass =
  /** HTTP 2xx — the unconditional write was accepted (invocation evidence only). */
  | "ack_success"
  /**
   * HTTP non-2xx — the request was rejected. INCLUDING 429: rate limiting is
   * a transport pacing event, never consistency evidence.
   */
  | "ack_error"
  /** Transport failure/timeout — the outcome is unknowable from executor vantage. */
  | "ack_lost";

export type KvWriteInvocation = {
  readonly attempt: number;
  /** ISO timestamp — evidence, never logic. */
  readonly at: string;
  readonly httpStatus: number | null;
  readonly ack: KvWriteAckClass;
  readonly detail: string;
};

export type KvWriteExecutionEvidence = {
  readonly executorClass: "executor_kv_edit";
  /**
   * The operation as actually attempted — reconciled against the binding
   * downstream. `unconditional: true` is the structural record of the lost
   * CAS: this PUT applies regardless of any observed prior revision. There
   * is deliberately NO `predicate` field (contrast the Supabase lane).
   */
  readonly operation: {
    readonly namespaceId: string;
    readonly key: string;
    readonly set: { readonly field: string; readonly revision: number };
    readonly unconditional: true;
  } | null;
  readonly attempts: readonly KvWriteInvocation[];
  /**
   * Executor-vantage execution fidelity. "match" iff the bound operation was
   * attempted AND acknowledged (ack_success). ack_error / ack_lost /
   * operation mismatch / no actuation are all "deviation" — and even
   * ack_success never establishes reality.
   */
  readonly intendedVsActual: "match" | "deviation";
  /** Present iff no actuation was attempted (pre-observation gate fired). */
  readonly noActuationReason?: string;
  readonly detail: string;
};

// ─── Observer-side reality evidence ──────────────────────────────────────────

export type KvReadOutcome =
  /** An envelope was read successfully. */
  | "value"
  /**
   * HTTP 404 — the key is absent. On KV this is INCONCLUSIVE, never "write
   * failed": negative-lookup caching is documented on KV, so an absent read
   * may be a cached miss from before the write.
   */
  | "absent"
  /** Transport failure, 5xx, or timeout — the observer could not reach reality. */
  | "unavailable"
  /** The response did not carry a well-formed envelope. */
  | "malformed"
  /** 401/403 — the observer credential was rejected. */
  | "unauthorized"
  /**
   * HTTP 429 — rate limited. A transport pacing event inside the bounded
   * retry policy, NEVER a reality verdict.
   */
  | "rate_limited";

export type KvReadAttempt = {
  readonly attempt: number;
  readonly at: string;
  readonly httpStatus: number | null;
  readonly outcome: KvReadOutcome;
  /** Present iff outcome === "value". */
  readonly envelope?: KvValueEnvelope;
  readonly detail: string;
};

export type KvObservation = {
  readonly observerClass: "observer_kv_read";
  /** The declared observation scope — the complete envelope field set. */
  readonly observationScope: readonly string[];
  readonly reads: readonly KvReadAttempt[];
  /** True iff a conclusive read (agree or disagree) was reached within budget. */
  readonly converged: boolean;
  /** The last successfully read envelope, if any. */
  readonly finalEnvelope: KvValueEnvelope | null;
  /**
   * Readback semantics (exact rule — eventual-consistency adaptation):
   *
   *   agree     — the observed envelope carries the expected target value AND
   *               the expected next revision AND the witness field is intact.
   *   disagree  — the observed envelope AFFIRMATIVELY differs: a state that
   *               cannot be explained by edge-cache staleness — wrong value,
   *               unexpected higher revision, mutated witness, or the bound
   *               post value+revision with a mutated witness (collateral).
   *   unknown   — a STALE-EXPLAINABLE state is still observed when the
   *               convergence deadline is exhausted: the bound prior state,
   *               an older prior-value revision, or key-absence. On KV such a
   *               read may mean: not yet propagated / negative-or-stale edge
   *               cache / never applied / a later overwrite not yet visible.
   *               Non-convergence is NEVER contradiction. Also unknown when
   *               no successful envelope read was ever obtained (unavailable /
   *               malformed / unauthorized / rate-limited within budget).
   *
   * The convergence deadline is a READ BUDGET, not an affirmative failure
   * condition. Uncertainty is never silently upgraded into contradiction.
   */
  readonly realityVerdict: "agree" | "disagree" | "unknown";
  readonly collateral: {
    /** True iff the witness field differs from the bound expectation. */
    readonly witnessDelta: boolean;
    readonly detail: string;
  };
  readonly detail: string;
};

// ─── Reconciliation ──────────────────────────────────────────────────────────

// The verdict set and the reconciliation shape are surface-agnostic: they are
// REUSED from the Supabase lane's types (ApiWriteVerdict /
// ApiWriteReconciliation). The verdict algebra itself lives in
// kv-reconcile.ts and is the certified algebra preserved exactly — a
// conformance test proves equivalence with reconcileApiWrite.

// ─── Evidence record (replayable, secret-free) ───────────────────────────────

/**
 * Enough to replay the verdict without secrets. Contains credential CLASSES,
 * never credential values; HTTP outcome classifications, never raw payloads.
 */
export type KvWriteEvidenceRecord = {
  readonly artifact: "USESTEADY_EVENTUALLY_CONSISTENT_KV_CERTIFICATION_V1";
  readonly authoritySource: "operator_authorization_2026-08-07_eventually_consistent_kv_certification_v1";
  readonly binding: KvWriteBinding;
  readonly execution: KvWriteExecutionEvidence;
  readonly observation: KvObservation;
  readonly reconciliation: ApiWriteReconciliation;
  /** SHA-256 over the canonical record (excluding this field). */
  readonly contentHash: string;
};
