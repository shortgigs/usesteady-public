/**
 * P1 Authority Assertion V1 — Core-side fail-closed verifier.
 *
 * Verification has TWO independent halves, both required:
 *   1. AUTHENTICITY — the Ed25519 signature over the canonical payload verifies
 *      against the Portal authority public key PINNED in Core's environment
 *      (never against the key embedded in the assertion — that embedded key is
 *      diagnostic only and must merely EQUAL the pinned one).
 *   2. BINDING — every expected field equals the exact live gate Core is
 *      deciding on (org, run/thread, step, decision, decided_at, basis,
 *      subject/display, decision_id). A valid signature for decision A must
 *      never authorize decision B.
 *
 * Any failure returns ok:false with a machine-readable reason; callers treat a
 * failed verification as "no verified authority evidence" and fail closed per
 * path (approve degrades to local approval / ratify is refused).
 */
import { type MappedRetirementEnvelopeReader } from "../../claude/evidence-basis.js";
import type { PortalAuthorityTrust } from "./trust.js";
import { type AuthorityAssertionV1, type AuthorityVerificationResult, type DecisionOriginAuthorityVerificationResult, type DecisionOriginAuthorityAssertionV2, type ExpectedAuthorityBinding, type RetirementAuthorityAssertionV3, type RetirementAuthorityVerificationResult, type RetirementBasisRelationV1, type RetirementDecisionOriginV2 } from "./types.js";
export declare function canonicalRetirementRelations(relations: readonly RetirementBasisRelationV1[]): string;
export declare function parseRetirementDecisionOriginV2(raw: unknown): RetirementDecisionOriginV2 | null;
export declare function parseRetirementAuthorityAssertionV3(raw: unknown): {
    readonly ok: true;
    readonly assertion: RetirementAuthorityAssertionV3;
} | {
    readonly ok: false;
};
/** Structural parse of an untrusted assertion envelope. No crypto here. */
export declare function parseAuthorityAssertion(raw: unknown): {
    readonly ok: true;
    readonly assertion: AuthorityAssertionV1;
} | {
    readonly ok: false;
};
export declare function parseDecisionOriginAuthorityAssertionV2(raw: unknown): {
    readonly ok: true;
    readonly assertion: DecisionOriginAuthorityAssertionV2;
} | {
    readonly ok: false;
};
export declare function verifyDecisionOriginAuthorityAssertionV2(raw: unknown, trust: PortalAuthorityTrust, expected: ExpectedAuthorityBinding): DecisionOriginAuthorityVerificationResult;
export declare function verifyRetirementAuthorityAssertionV3(raw: unknown, trust: PortalAuthorityTrust, expected: ExpectedAuthorityBinding, readback: {
    readonly storeDir: string;
    readonly artifactId: string;
    readonly readEnvelopeById: MappedRetirementEnvelopeReader;
}): RetirementAuthorityVerificationResult;
/**
 * Verify an untrusted assertion against the pinned trust anchor and the exact
 * expected binding. Fail-closed on every axis.
 */
export declare function verifyAuthorityAssertion(raw: unknown, trust: PortalAuthorityTrust, expected: ExpectedAuthorityBinding): AuthorityVerificationResult;
//# sourceMappingURL=verify.d.ts.map