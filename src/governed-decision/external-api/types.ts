/**
 * External API write certification — types (USESTEADY_EXTERNAL_API_WRITE_CERTIFICATION_V1).
 *
 * The governed-decision spine's filesystem result, tested across an external
 * authority boundary. Governing invariant:
 *
 *   A write-capable actor cannot establish the truth of its own successful
 *   execution. Remote success is admissible only when separately authorized
 *   observation of the governed resource provides sufficient evidence to
 *   reconcile the actual state with the approved state. Preserve uncertainty
 *   as uncertainty.
 *
 * Certification resource (exactly one, isolated, reversible):
 *
 *   table          public.usesteady_api_write_cert_scratch
 *   row            id = 'cert-row-1'
 *   governed field "field"     — the mutable governed value ("off" -> "on")
 *   revision       "revision"  — monotonically controlled, CAS predicate
 *   witness field  "note"      — must remain untouched; a change is in-scope
 *                                collateral mutation
 *
 * Authority separation (structural, database-enforced):
 *
 *   executor  service_role key — may perform the authorized write
 *   observer  anon key + RLS   — SELECT only; physically incapable of the write
 *
 * The observer credential CLASS is recorded in evidence. The key material
 * never is. No credential value appears in any evidence record, log, or test.
 *
 * Spine correspondence (same two dimensions as the filesystem adapter):
 *
 *   intendedVsActual  — executor-vantage execution fidelity (was the bound
 *                       operation attempted and acknowledged?)
 *   realityVerdict    — observer-vantage reality (does the independently
 *                       observed state reconcile with the approved state?)
 *   feedsNextCycle    — intendedVsActual === "match" && realityVerdict === "agree"
 *                       (the corrected spine rule: unknown NEVER feeds)
 */

// ─── Credentials ─────────────────────────────────────────────────────────────

export type ApiCredentialClass = "executor_service_role" | "observer_anon";

export type ApiCredential = {
  /** Credential class — the ONLY property that may appear in evidence. */
  readonly class: ApiCredentialClass;
  /** PostgREST base URL, e.g. https://<project>.supabase.co */
  readonly url: string;
  /** Key material. NEVER logged, persisted, hashed, or included in evidence. */
  readonly key: string;
};

// ─── Binding (the approved operation) ────────────────────────────────────────

/**
 * The bound, approved operation. Before actuation the driver binds: resource
 * identity, expected prior value, expected prior revision, expected target
 * value, expected next revision, and the declared observation scope.
 *
 * The mutation is deterministic set-to-value with a revision predicate:
 *
 *   SET field = expectedTargetValue, revision = expectedNextRevision
 *   WHERE id = rowId AND revision = expectedPriorRevision
 */
export type ApiWriteBinding = {
  readonly table: string;
  readonly rowId: string;
  readonly governedField: string;
  readonly revisionField: string;
  readonly witnessField: string;
  readonly expectedPriorValue: string;
  readonly expectedPriorRevision: number;
  readonly expectedTargetValue: string;
  readonly expectedNextRevision: number;
  /** The witness value that must survive actuation untouched. */
  readonly expectedWitnessValue: string;
  /**
   * The complete declared observation field set — every column of the single
   * governed row. A sibling-field mutation on this row is in-scope collateral.
   * Mutation of any other row/resource is outside the certification claim.
   */
  readonly observedFields: readonly string[];
};

/** The certification transition: field "off" -> "on" on the single scratch row. */
export const SUPABASE_SCRATCH_TABLE = "usesteady_api_write_cert_scratch";
export const SUPABASE_SCRATCH_ROW_ID = "cert-row-1";

export function makeScratchBinding(priorRevision: number): ApiWriteBinding {
  return {
    table: SUPABASE_SCRATCH_TABLE,
    rowId: SUPABASE_SCRATCH_ROW_ID,
    governedField: "field",
    revisionField: "revision",
    witnessField: "note",
    expectedPriorValue: "off",
    expectedPriorRevision: priorRevision,
    expectedTargetValue: "on",
    expectedNextRevision: priorRevision + 1,
    expectedWitnessValue: "witness",
    observedFields: ["id", "field", "revision", "note"],
  };
}

// ─── Executor-side invocation evidence (ack — never reality) ─────────────────

/**
 * The write response is invocation evidence ONLY. No ack class — including
 * ack_success — independently establishes reality.
 */
export type ApiWriteAckClass =
  /** HTTP 2xx; the returned representation carries the bound post-state row. */
  | "ack_success"
  /** HTTP 2xx with zero rows — the CAS predicate did not hold; nothing written. */
  | "ack_refused"
  /** HTTP 4xx/5xx — the request was rejected. */
  | "ack_error"
  /** Transport failure/timeout — the outcome is unknowable from executor vantage. */
  | "ack_lost";

export type ApiWriteInvocation = {
  readonly attempt: number;
  /** ISO timestamp — evidence, never logic. */
  readonly at: string;
  readonly httpStatus: number | null;
  readonly ack: ApiWriteAckClass;
  readonly rowsReturned: number | null;
  readonly detail: string;
};

export type ApiWriteExecutionEvidence = {
  readonly executorClass: "executor_service_role";
  /** The operation as actually attempted — reconciled against the binding. */
  readonly operation: {
    readonly table: string;
    readonly rowId: string;
    readonly set: { readonly field: string; readonly revision: number };
    readonly predicate: { readonly rowId: string; readonly revision: number };
  } | null;
  readonly attempts: readonly ApiWriteInvocation[];
  /**
   * Executor-vantage execution fidelity. "match" iff the bound operation was
   * attempted AND acknowledged (ack_success). ack_refused / ack_error /
   * ack_lost / operation mismatch / no actuation are all "deviation" — the
   * executor cannot certify its own success from anything less than an ack,
   * and even an ack never establishes reality.
   */
  readonly intendedVsActual: "match" | "deviation";
  /** Present iff no actuation was attempted (pre-observation gate fired). */
  readonly noActuationReason?: string;
  readonly detail: string;
};

// ─── Observer-side reality evidence ──────────────────────────────────────────

export type ApiObservedRow = {
  readonly field: string;
  readonly revision: number;
  readonly note: string;
};

export type ApiReadOutcome =
  /** A row was read successfully. */
  | "row"
  /** Transport failure, 5xx, or timeout — the observer could not reach reality. */
  | "unavailable"
  /** The response did not carry the declared field set. */
  | "malformed"
  /** 401/403 — the observer credential was rejected. */
  | "unauthorized";

export type ApiReadAttempt = {
  readonly attempt: number;
  readonly at: string;
  readonly httpStatus: number | null;
  readonly outcome: ApiReadOutcome;
  /** Present iff outcome === "row". */
  readonly row?: ApiObservedRow;
  readonly detail: string;
};

export type ApiObservation = {
  readonly observerClass: "observer_anon";
  /** The declared observation field set actually read. */
  readonly observationScope: readonly string[];
  readonly reads: readonly ApiReadAttempt[];
  /** True iff a conclusive read (agree or disagree) was reached within budget. */
  readonly converged: boolean;
  /** The last successfully read row, if any. */
  readonly finalRow: ApiObservedRow | null;
  /**
   * Readback semantics (exact rule):
   *
   *   agree     — the observed row carries the expected target value AND the
   *               expected next revision AND the witness field is intact.
   *   disagree  — the observed row AFFIRMATIVELY differs: wrong value,
   *               unexpected revision, prior value at a higher revision, or
   *               the expected post value+revision with a mutated witness
   *               (in-scope collateral).
   *   unknown   — the prior state is still observed when the convergence
   *               deadline is exhausted (stale read is uncertainty, never
   *               contradiction), OR no successful row read was ever obtained
   *               (observer unavailable / malformed / unauthorized).
   *
   * The convergence deadline is a READ BUDGET, not an affirmative failure
   * condition: exhausting it while only the prior state is visible yields
   * unknown, not disagree. Uncertainty is never silently upgraded into
   * contradiction.
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

export type ApiWriteVerdict =
  /** match + agree — the bound operation executed and reality confirms it. */
  | "VERIFIED_SUCCESS"
  /** deviation + agree — reality confirms the approved state, but the executor
   *  cannot confirm its own execution (lost response / CAS-refused retry). */
  | "REALITY_CONFIRMED_EXECUTION_UNCONFIRMED"
  /** realityVerdict disagree — observed reality contradicts the approved state. */
  | "CONTRADICTED"
  /** realityVerdict unknown — reality is unresolved; uncertainty preserved. */
  | "UNRESOLVED"
  /** Pre-observation affirmatively differed from the expected prior state (and
   *  was not already the post state). No actuation was attempted. */
  | "PRECONDITION_FAILED"
  /** Pre-observation showed the approved post-state already holds. No actuation
   *  was attempted — the idempotent no-op path. */
  | "ALREADY_SATISFIED";

export type ApiWriteReconciliation = {
  readonly verdict: ApiWriteVerdict;
  readonly intendedVsActual: "match" | "deviation";
  readonly realityVerdict: "agree" | "disagree" | "unknown";
  /**
   * The corrected spine rule: feedsNextCycle is true IFF
   * intendedVsActual === "match" && realityVerdict === "agree".
   * Unknown reality NEVER feeds the next cycle as a verified basis.
   */
  readonly feedsNextCycle: boolean;
  readonly rationale: string;
};

// ─── Evidence record (replayable, secret-free) ───────────────────────────────

/**
 * Enough to replay the verdict without secrets. Contains credential CLASSES,
 * never credential values; HTTP outcome classifications, never raw payloads.
 */
export type ApiWriteEvidenceRecord = {
  readonly artifact: "USESTEADY_EXTERNAL_API_WRITE_CERTIFICATION_V1";
  readonly authoritySource: "operator_authorization_section_1_to_12";
  readonly binding: ApiWriteBinding;
  readonly execution: ApiWriteExecutionEvidence;
  readonly observation: ApiObservation;
  readonly reconciliation: ApiWriteReconciliation;
  /** SHA-256 over the canonical record (excluding this field). */
  readonly contentHash: string;
};
