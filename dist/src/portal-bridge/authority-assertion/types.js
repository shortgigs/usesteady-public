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
export const AUTHORITY_ASSERTION_SCHEMA = "usesteady.authority_assertion.v1";
export const AUTHORITY_ASSERTION_V2_SCHEMA = "usesteady.authority_assertion.v2";
export const DECISION_ORIGIN_SCHEMA = "usesteady.decision_origin.v1";
export const RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA = "usesteady.authority_assertion.v3";
export const RETIREMENT_DECISION_ORIGIN_V2_SCHEMA = "usesteady.decision_origin.v2";
/**
 * P3 Phase 2 (additive): the only explicit decision relation that records a
 * human supersession of a preserved model advisory position. Plain "approve"
 * is NEVER recorded as supersession — absence of this field means ordinary
 * approval.
 */
export const AUTHORITY_DECISION_RELATION_SUPERSESSION = "proceed_despite_model_position";
/**
 * P5 V1 (additive): the only explicit decision relation that records a human
 * retirement of a preserved model advisory on named evidence. Distinct from
 * proceed_despite — the two must never be interchangeable.
 */
export const AUTHORITY_DECISION_RELATION_RETIREMENT = "retire_model_position";
//# sourceMappingURL=types.js.map