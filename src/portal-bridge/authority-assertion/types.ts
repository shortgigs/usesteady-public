/**
 * P1 Authority Assertion V1 — Core-side types.
 *
 * One canonical signed authority assertion (mirrors the Portal emitter in
 * usesteady-ops `lib/portal/authorityAssertion/authorityAssertion.ts`). The
 * assertion is produced at the Portal's authenticated decision boundary and
 * carried to Core on both Portal-mediated paths: the pending-approval bridge
 * decisions poll and the governed-handoff ratify.
 *
 * Evidence status is a HARD distinction (P1 requirement 6):
 *   "portal_signed_verified" — signature verified against a Core-pinned Portal
 *                              authority key AND every expected binding field
 *                              matched the live gate.
 *   "self_asserted"          — no usable signed proof (pinning not configured,
 *                              assertion absent). The carried identity/time are
 *                              transport metadata, NOT authenticated provenance.
 * Purely local approvals (terminal y/n, --yes, break-glass, SDK capture) NEVER
 * carry "portal_signed_verified".
 */

export const AUTHORITY_ASSERTION_SCHEMA = "usesteady.authority_assertion.v1" as const;
export const AUTHORITY_ASSERTION_V2_SCHEMA = "usesteady.authority_assertion.v2" as const;
export const DECISION_ORIGIN_SCHEMA = "usesteady.decision_origin.v1" as const;
export const RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA =
  "usesteady.authority_assertion.v3" as const;
export const RETIREMENT_DECISION_ORIGIN_V2_SCHEMA =
  "usesteady.decision_origin.v2" as const;

/**
 * P3 Phase 2 (additive): the only explicit decision relation that records a
 * human supersession of a preserved model advisory position. Plain "approve"
 * is NEVER recorded as supersession — absence of this field means ordinary
 * approval.
 */
export const AUTHORITY_DECISION_RELATION_SUPERSESSION =
  "proceed_despite_model_position" as const;

/**
 * P5 V1 (additive): the only explicit decision relation that records a human
 * retirement of a preserved model advisory on named evidence. Distinct from
 * proceed_despite — the two must never be interchangeable.
 */
export const AUTHORITY_DECISION_RELATION_RETIREMENT =
  "retire_model_position" as const;

export type AuthorityDecisionRelation =
  | typeof AUTHORITY_DECISION_RELATION_SUPERSESSION
  | typeof AUTHORITY_DECISION_RELATION_RETIREMENT;

/** A signed reference to one preserved model advisory position. */
export type AuthorityAssertionModelPositionRef = {
  /** Content id: sha256 over the canonical model advisory event (Core). */
  readonly model_position_id: string;
  /** Evidence id: the ucp.model_advisory.v1 envelope id that preserves the exact content. */
  readonly position_hash: string;
};

export type RetirementBasisRelationV1 = {
  readonly model_position: AuthorityAssertionModelPositionRef;
  readonly resolving_evidence: {
    readonly evidence_basis_id: string;
    readonly evidence_basis_hash: string;
  };
};

export type RetirementDecisionOriginV2 = {
  readonly schema: typeof RETIREMENT_DECISION_ORIGIN_V2_SCHEMA;
  readonly origin_id: string;
  readonly decision_id: string;
  readonly authenticated_actor: {
    readonly provider: "supabase";
    readonly subject_id: string;
  };
  readonly authority_subject_id: string;
  readonly approver_display: string | null;
  readonly organization_id: string;
  readonly authorized_context: {
    readonly role: "org:admin" | "org:member";
    readonly capability: "approve_steps";
  };
  readonly decision: "approve";
  readonly decided_at: string;
  readonly run_id: string;
  readonly step_index: number;
  readonly gate_cycle: number;
  readonly decision_basis: string;
  readonly decision_relation: typeof AUTHORITY_DECISION_RELATION_RETIREMENT;
  readonly retirement_basis_relations: readonly RetirementBasisRelationV1[];
};

export type RetirementAuthorityAssertionV3 = {
  readonly schema: typeof RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA;
  readonly payload: {
    readonly version: typeof RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA;
    readonly decision_origin: RetirementDecisionOriginV2;
    readonly decision_origin_hash: string;
    readonly key_id: string;
  };
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly public_key: string;
    readonly signature: string;
    readonly signed_at: string;
  };
};

export type AuthorityAssertionPayloadV1 = {
  readonly version: typeof AUTHORITY_ASSERTION_SCHEMA;
  readonly decision_id: string;
  readonly organization_id: string;
  readonly authority_subject_id: string;
  readonly approver_display: string | null;
  readonly decision: "approve" | "reject";
  readonly decided_at: string;
  readonly run_id: string | null;
  readonly thread_id: string | null;
  readonly step_index: number | null;
  readonly decision_basis: string;
  readonly key_id: string;
  /**
   * P3 Phase 2 (additive, optional): present ONLY when the human made the
   * explicit supersession decision on a gate carrying model advisories. When
   * present, `model_positions` must be non-empty. Covered by the signature.
   */
  readonly decision_relation?: AuthorityDecisionRelation;
  /**
   * P3 Phase 2 / P5 V1 (additive, optional): the exact preserved model
   * advisory positions the human proceeded despite (P3) or retired (P5).
   * Covered by the signature.
   */
  readonly model_positions?: readonly AuthorityAssertionModelPositionRef[];
  /**
   * P5 V1 (additive, optional): named resolving evidence ids. REQUIRED and
   * non-empty when decision_relation is retire_model_position. Covered by
   * the signature. Forbidden on proceed_despite.
   */
  readonly resolving_evidence_ids?: readonly string[];
};

export type AuthorityAssertionV1 = {
  readonly schema: typeof AUTHORITY_ASSERTION_SCHEMA;
  readonly payload: AuthorityAssertionPayloadV1;
  readonly signature: {
    readonly algorithm: "Ed25519";
    /** Diagnostic only — NEVER a trust source. Trust comes from the pinned map. */
    readonly public_key: string;
    readonly signature: string;
    readonly signed_at: string;
  };
};

export type DecisionOriginV1 = {
  readonly schema: typeof DECISION_ORIGIN_SCHEMA;
  readonly origin_id: string;
  readonly decision_id: string;
  readonly authenticated_actor: {
    readonly provider: "supabase";
    readonly subject_id: string;
  };
  readonly authority_subject_id: string;
  readonly approver_display: string | null;
  readonly organization_id: string;
  readonly authorized_context: {
    readonly role: "org:admin" | "org:member";
    readonly capability: "approve_steps";
  };
  readonly decision: "approve" | "reject";
  readonly decided_at: string;
  readonly run_id: string;
  readonly step_index: number;
  readonly gate_cycle: number;
  readonly decision_basis: string;
  readonly decision_relation: AuthorityDecisionRelation | null;
  readonly model_positions: readonly AuthorityAssertionModelPositionRef[];
  readonly resolving_evidence_ids: readonly string[];
};

export type DecisionOriginAuthorityAssertionV2 = {
  readonly schema: typeof AUTHORITY_ASSERTION_V2_SCHEMA;
  readonly payload: {
    readonly version: typeof AUTHORITY_ASSERTION_V2_SCHEMA;
    readonly decision_origin: DecisionOriginV1;
    readonly decision_origin_hash: string;
    readonly key_id: string;
  };
  readonly signature: {
    readonly algorithm: "Ed25519";
    readonly public_key: string;
    readonly signature: string;
    readonly signed_at: string;
  };
};

export type AuthorityAssertion =
  | AuthorityAssertionV1
  | DecisionOriginAuthorityAssertionV2
  | RetirementAuthorityAssertionV3;

export type AuthorityEvidenceStatus = "portal_signed_verified" | "self_asserted";

/** What the caller expects the assertion to bind to (the exact live gate). */
export type ExpectedAuthorityBinding = {
  readonly organization_id: string;
  readonly run_id: string | null;
  readonly thread_id: string | null;
  readonly step_index: number | null;
  readonly decision: "approve" | "reject";
  /** Path A: exact equality with the polled entry. Path B: ISO presence only. */
  readonly decided_at?: string;
  readonly decision_basis: string;
  /** Path B: the ratify body's approver (must equal the signed subject). */
  readonly authority_subject_id?: string;
  /** Path A: the polled entry's decided_by (must equal the signed display). */
  readonly approver_display?: string | null;
  /** Path A: the polled entry's gate row id, when the Portal supplied it. */
  readonly decision_id?: string;
  /**
   * P3 Phase 2 (additive, optional): when the live gate carried model advisory
   * positions, the signed assertion MUST carry the explicit supersession
   * relation plus the exact position refs (fail-closed otherwise). When the
   * live gate carried none, an assertion carrying these fields fails closed.
   */
  readonly decision_relation?: AuthorityDecisionRelation;
  readonly model_positions?: readonly AuthorityAssertionModelPositionRef[];
  readonly resolving_evidence_ids?: readonly string[];
  readonly retirement_basis_relations?: readonly RetirementBasisRelationV1[];
  /** Pending-path v2 binding. Omitted for governed-handoff v1 compatibility. */
  readonly gate_cycle?: number;
};

export type AuthorityVerificationFailure =
  | "malformed_assertion"
  | "schema_mismatch"
  | "unknown_key_id"
  | "embedded_key_mismatch"
  | "invalid_signature"
  | `binding_mismatch:${string}`;

export type AuthorityVerificationResult =
  | { readonly ok: true; readonly assertion: AuthorityAssertionV1 }
  | { readonly ok: false; readonly reason: AuthorityVerificationFailure };

export type DecisionOriginAuthorityVerificationResult =
  | { readonly ok: true; readonly assertion: DecisionOriginAuthorityAssertionV2 }
  | { readonly ok: false; readonly reason: AuthorityVerificationFailure };

export type MappedRetirementDiagnostic =
  | "mapped_relation_reference_missing"
  | "mapped_store_configuration_required"
  | "mapped_store_unavailable"
  | "mapped_o_reference_absent"
  | "mapped_o_reference_corrupt"
  | "mapped_e_reference_absent"
  | "mapped_e_reference_corrupt";

export type RetirementAuthorityVerificationResult =
  | { readonly ok: true; readonly assertion: RetirementAuthorityAssertionV3 }
  | {
      readonly ok: false;
      readonly reason: AuthorityVerificationFailure | MappedRetirementDiagnostic;
    };
