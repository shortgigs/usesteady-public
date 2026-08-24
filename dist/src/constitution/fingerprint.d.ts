/**
 * Constitution Materialization V1 — Decision Basis fingerprint.
 *
 * Implements USESTEADY_CONSTITUTION_V1 Article VI (the Temporal Fingerprint Rule):
 *
 *     fingerprint = hash(Decision Basis)
 *
 * The fingerprint is provenance, not optimization (INV-TMP-1): a decision
 * recorded with its basis fingerprint can be re-verified later; one recorded
 * without it is non-recertifiable forever.
 *
 * This module is the basis-level analogue of src/workflow/spec-hash.ts. The
 * spec hash fingerprints the Proposal alone; this fingerprints the full
 * eight-class Decision Basis, so future non-spec facts (Repository SHA,
 * Dependencies, Environment, Principal Authority) become covered without
 * changing this surface.
 *
 * Pure: SHA-256 via node:crypto only. No network. No external trust.
 * The digest is a 64-char lowercase hex string.
 */
import type { DecisionBasis } from "./decision-basis.js";
import type { WorkflowSpec } from "../workflow/types.js";
/**
 * Compute the deterministic SHA-256 hex digest of a Decision Basis.
 *
 * @param basis  The eight-class Decision Basis.
 * @returns      A 64-character lowercase hex string (full SHA-256).
 */
export declare function computeDecisionBasisFingerprint(basis: DecisionBasis): string;
/**
 * Convenience: assemble the basis from a WorkflowSpec and fingerprint it.
 *
 * This is the value recorded at approval time and recomputed at the execution
 * side-effect surface (Article V, INV-COMP-2).
 */
export declare function fingerprintWorkflowSpec(spec: WorkflowSpec): string;
/** Verification result for a Decision Basis fingerprint re-check. */
export type DecisionBasisFingerprintVerification = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly expected: string;
    readonly actual: string;
};
/**
 * Re-check that a Decision Basis still produces the fingerprint recorded at
 * approval time (Article V, INV-COMP-2 — lifecycle safety).
 *
 * Returns `{ ok: true }` on match; `{ ok: false, expected, actual }` on
 * mismatch. Pure: the caller decides what to do on mismatch (the coordinator
 * fails closed).
 *
 * @param basis     The basis recomputed from the actual execution artifact.
 * @param expected  The fingerprint recorded with the approval record.
 */
export declare function verifyDecisionBasisFingerprint(basis: DecisionBasis, expected: string): DecisionBasisFingerprintVerification;
//# sourceMappingURL=fingerprint.d.ts.map