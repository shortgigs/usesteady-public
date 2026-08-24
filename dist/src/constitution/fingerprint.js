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
import { createHash } from "node:crypto";
import { assembleDecisionBasis } from "./decision-basis.js";
/**
 * Canonical, hash-stable serialization of a Decision Basis.
 *
 * Field order is fixed here (the eight classes in Article I order), not by
 * object construction order. Two bases with identical content but different key
 * insertion order produce identical strings.
 */
function canonicalBasisPayload(basis) {
    const payload = {
        proposal: {
            name: basis.proposal.name,
            tasks: basis.proposal.tasks.map((t) => ({
                input: t.input,
                runtime: t.runtime,
                operationType: t.operationType,
                targetFiles: t.targetFiles ? [...t.targetFiles] : null,
                content: t.content,
                newPath: t.newPath,
                command: t.command,
                structuredReplace: t.structuredReplace
                    ? {
                        oldValue: t.structuredReplace.oldValue,
                        newValue: t.structuredReplace.newValue,
                        filePath: t.structuredReplace.filePath,
                    }
                    : null,
            })),
        },
        repository: basis.repository
            ? {
                identity: basis.repository.identity,
                commit: basis.repository.commit,
                dirty: basis.repository.dirty,
            }
            : null,
        configuration: {
            defaultRuntime: basis.configuration.defaultRuntime,
            maxRetries: basis.configuration.maxRetries,
        },
        policies: {
            ocdAdditionalProhibitedGlobs: basis.policies.ocdAdditionalProhibitedGlobs
                ? [...basis.policies.ocdAdditionalProhibitedGlobs]
                : null,
        },
        dependencies: basis.dependencies,
        environment: basis.environment,
        principalAuthority: basis.principalAuthority,
        retrievedEvidenceUsed: basis.retrievedEvidenceUsed,
    };
    return JSON.stringify(payload);
}
/**
 * Compute the deterministic SHA-256 hex digest of a Decision Basis.
 *
 * @param basis  The eight-class Decision Basis.
 * @returns      A 64-character lowercase hex string (full SHA-256).
 */
export function computeDecisionBasisFingerprint(basis) {
    return createHash("sha256").update(canonicalBasisPayload(basis)).digest("hex");
}
/**
 * Convenience: assemble the basis from a WorkflowSpec and fingerprint it.
 *
 * This is the value recorded at approval time and recomputed at the execution
 * side-effect surface (Article V, INV-COMP-2).
 */
export function fingerprintWorkflowSpec(spec) {
    return computeDecisionBasisFingerprint(assembleDecisionBasis(spec));
}
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
export function verifyDecisionBasisFingerprint(basis, expected) {
    const actual = computeDecisionBasisFingerprint(basis);
    if (actual === expected)
        return { ok: true };
    return { ok: false, expected, actual };
}
//# sourceMappingURL=fingerprint.js.map