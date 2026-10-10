/**
 * Decision Record Bridge (DECISION_RECORD_BRIDGE_V1) - frozen wire types.
 *
 * Direction: Core (Runtime) -> Portal. This is the SECOND Core->Portal side-channel
 * (after the Execution Return Bridge). It carries the kernel's canonical
 * `GovernedDecisionRecord` to the Portal as the `usesteady.decision-record/v1`
 * payload so Portal V2's O4 (Proposals) / O5 (Proof) surfaces project REAL
 * governed decisions instead of remaining `Unavailable`.
 *
 * Contract (single source of truth): usesteady-ops
 *   docs/product/decision-record-bridge-contract-v1.md and the Portal-side
 *   validator lib/portal/decisionRecord/{types,validate,canonicalHash}.ts. Core
 *   never imports Portal code and Portal never imports Core code; this wire shape
 *   IS the contract. Any breaking change requires a new schema id
 *   (`usesteady.decision-record/v2`), never an in-place edit.
 *
 * Hash parity (INV-DEC-012): `record_hash` is sha256 over the canonical
 * serialization of the payload WITHOUT `record_hash`, using the SAME
 * stableStringify as src/ucp/hashes.ts (which the Portal mirrors in
 * canonicalHash.ts). Because the wire object is built UNDEFINED-FREE, it survives
 * the JSON round-trip unchanged, so the Portal's recompute over the parsed body
 * reproduces Core's digest exactly.
 *
 * Privacy: there is deliberately NO field for chain-of-thought, raw model output,
 * prompts, tokens, or secrets. The Portal validator hard-rejects a set of
 * FORBIDDEN_KEYS recursively; this type only exposes governed, inspectable facts.
 */

/** Frozen schema discriminator. Literal type - any other value is a bug. */
export const DECISION_RECORD_SCHEMA = "usesteady.decision-record/v1" as const;

/**
 * The kernel emits FINAL (ratified) records, so the Core emitter always uses the
 * `post_execution` phase. `pre_approval` is part of the contract but is reserved
 * for a future draft-emission slice; v1 of this bridge does not emit it.
 */
export type DecisionRecordPhase = "pre_approval" | "post_execution";

export type DecisionRecordIntentSummary = {
  readonly human_request: string;
  readonly source?: string;
  readonly interpreted_summary?: string;
};

export type DecisionRecordPlanSummary = {
  readonly summary: string;
  /** "executed" when an executor actuated; otherwise "ratified". */
  readonly phase_state: string;
};

export type DecisionRecordFactor = {
  readonly category: string;
  readonly statement: string;
};

export type DecisionRecordRationaleSummary = {
  readonly summary: string;
  /** MUST be non-empty (Portal validator rejects an empty factor list). */
  readonly factors: readonly DecisionRecordFactor[];
};

/**
 * Governance authority block. `gate_state` is the human ratification verdict
 * (the product's sole authority signal). For `post_execution` the contract places
 * no constraint on its literal value.
 */
export type DecisionRecordAuthority = {
  readonly gate_state: string;
  readonly approver: string | null;
  /**
   * Typed ratifier seat (S1 / INV-SO-2), passed through verbatim from the
   * kernel record: "human" | "persona". `null` for records ratified before the
   * field existed (honest absence — never silently rendered as "human").
   * Portal surfaces MUST label a persona seat as persona wherever the approver
   * is shown; a persona ratification is never counted or rendered as human.
   */
  readonly approver_kind: "human" | "persona" | null;
  readonly ratified_at: string | null;
  readonly reality_verdict: string;
};

export type DecisionRecordProvenanceLinks = {
  readonly run_id: string;
  readonly ucp_root_id?: string;
};

/** Read-side epistemic classification, mirrored onto the wire (no authority). */
export type DecisionRecordEpistemicObject = {
  readonly kind: string;
  readonly status: string;
  readonly statement?: string;
};

/**
 * Kernel Truth Arbitration certification — additive optional on the wire
 * (USESTEADY_PORTAL_HANDOFF_CERT_V1). Omitted when the section is unavailable
 * so previously emitted record hashes stay stable. Never invent level.
 */
export type DecisionRecordCertificationReason = {
  readonly basis: string;
  readonly authority_level: string;
};

export type DecisionRecordCertification = {
  /** certified_by_source | requires_human_review | uncertified */
  readonly level: string;
  readonly reasons: readonly DecisionRecordCertificationReason[];
  /** number or the literal "unknown" — L3.S3 certifier output */
  readonly certified_confidence: number | "unknown";
};

/** Reality probe verdict (the independent on-disk / re-read check). */
export type DecisionRecordReality = {
  readonly verdict: string;
  readonly intended_vs_actual: string;
  readonly detail?: string;
};

/** A single actuated/refused op outcome - path + change-type + status only. */
export type DecisionRecordExecutionResult = {
  readonly op_kind: string;
  readonly path: string;
  readonly status: string;
  readonly detail: string;
};

export type DecisionRecordExecutionOutcome = {
  readonly ran_what_was_approved: boolean;
  readonly deterministic: boolean;
  readonly results: readonly DecisionRecordExecutionResult[];
};

/** Path + change-type only (no contents, no diff). */
export type DecisionRecordArtifactChange = {
  readonly path: string;
  readonly change_type: "create" | "update" | "delete" | "rename";
};

/**
 * A single declared, kernel-resolved Explicit Invocation Lineage edge, mirrored
 * onto the wire (snake_case). It carries id/path strings and the kernel's resolved
 * authority band ONLY - never content, never inherited memory. `authority_band` is
 * the core/k1 AuthorityLevel the kernel assigned at resolution (it is NOT copied
 * from the caller - INV-EIL-5). The A -> B -> C lineage graph is reconstructable
 * from `ref` across stored records alone.
 */
export type DecisionRecordReference = {
  /** ReferenceKind value (prior_observation | certified_decision | verified_artifact | asserted_artifact). */
  readonly kind: string;
  /** The declared target: a recordId, artifact id, or path. */
  readonly ref: string;
  /** core/k1 AuthorityLevel value the kernel resolved for this edge. */
  readonly authority_band: string;
  /** Whether a kernel sensor re-verified this edge IN this invocation. */
  readonly verified_in_this_invocation: boolean;
};

/**
 * The frozen `usesteady.decision-record/v1` wire payload (Core -> Portal).
 * Field names are snake_case to match the wire contract exactly. Optional fields
 * are OMITTED (never set to `undefined`) so the object is undefined-free and the
 * canonical hash survives the JSON round-trip (INV-DEC-012).
 */
export type DecisionRecordPayloadV1 = {
  readonly schema: typeof DECISION_RECORD_SCHEMA;
  readonly record_id: string;
  readonly record_phase: DecisionRecordPhase;
  readonly created_at: string;
  readonly record_hash: string;
  readonly intent_summary: DecisionRecordIntentSummary;
  readonly plan_summary: DecisionRecordPlanSummary;
  readonly rationale_summary: DecisionRecordRationaleSummary;
  readonly authority: DecisionRecordAuthority;
  readonly provenance_links: DecisionRecordProvenanceLinks;
  /** Non-null in post_execution; carries the human verdict + identity + time. */
  readonly approval: { readonly decision: string; readonly approver: string | null; readonly at: string | null } | null;
  /** Non-null when an executor actuated the approved ops; otherwise null. */
  readonly execution_outcome: DecisionRecordExecutionOutcome | null;
  /** The four read-side epistemic objects (inference/hypothesis/prediction/outcome). */
  readonly epistemic: readonly DecisionRecordEpistemicObject[];
  /**
   * Kernel certification (additive + optional). Present when truthArbitration
   * is connected/derived and carries a certification object. Portal CERT cell
   * reads this — not epistemic (which cannot carry certified_by_source).
   */
  readonly certification?: DecisionRecordCertification;
  /** Present only when a reality probe ran (observation connected/derived). */
  readonly reality?: DecisionRecordReality;
  /** Present only when at least one op actuated. Path + change-type only. */
  readonly artifacts_changed?: readonly DecisionRecordArtifactChange[];
  /**
   * Explicit Invocation Lineage (INV-EIL-2/-6): the DECLARED reference edges this
   * invocation depended on, kernel-resolved with their authority band. ADDITIVE +
   * OPTIONAL: present (and non-empty) ONLY when the invocation declared at least
   * one dependency; OMITTED for a fresh invocation so existing records' hashes are
   * unchanged (no v2 schema needed). Lets the Portal reconstruct the certified
   * A -> B -> C chain from `ref` across stored records.
   */
  readonly references?: readonly DecisionRecordReference[];
};

/** The payload WITHOUT its `record_hash` - the exact object the digest covers. */
export type DecisionRecordBody = Omit<DecisionRecordPayloadV1, "record_hash">;
