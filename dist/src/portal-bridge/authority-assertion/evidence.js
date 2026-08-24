/**
 * Portal Authority Assertions V1/V2 — durable evidence writer (Core).
 *
 * Appends one JSON line per consumed Portal-mediated authority assertion to
 * `<storeDir>/portal-authority-evidence.jsonl`. The assertion is preserved
 * VERBATIM (never collapsed back into a plain approver string) so a later
 * verifier can independently establish: this exact assertion was signed by the
 * trusted Portal authority key and bound to this exact governed decision.
 *
 * Best-effort and never-throw: evidence persistence must never block, advance,
 * or approve anything (same posture as the bridge itself).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AUTHORITY_ASSERTION_V2_SCHEMA, RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA, } from "./types.js";
export const PORTAL_AUTHORITY_EVIDENCE_FILE = "portal-authority-evidence.jsonl";
export function portalAuthorityEvidencePath(storeDir) {
    return join(storeDir, PORTAL_AUTHORITY_EVIDENCE_FILE);
}
export function appendPortalAuthorityEvidence(storeDir, record) {
    try {
        const { origin_id: _suppliedOriginId, decision_origin_hash: _suppliedOriginHash, ...baseRecord } = record;
        const assertion = record.assertion;
        const originId = assertion?.payload?.decision_origin?.origin_id;
        const originHash = assertion?.payload?.decision_origin_hash;
        const v3Relations = assertion?.schema === RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA
            ? assertion.payload?.decision_origin?.retirement_basis_relations
            : undefined;
        const relationDiagnostics = v3Relations?.map((relation) => ({
            model_position_id: relation.model_position?.model_position_id,
            position_hash: relation.model_position?.position_hash,
            evidence_basis_id: relation.resolving_evidence?.evidence_basis_id,
            evidence_basis_hash: relation.resolving_evidence?.evidence_basis_hash,
        }));
        const persistedRecord = record.verification === "portal_signed_verified" &&
            (assertion?.schema === AUTHORITY_ASSERTION_V2_SCHEMA ||
                assertion?.schema === RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA) &&
            typeof originId === "string" &&
            typeof originHash === "string"
            ? {
                ...baseRecord,
                origin_id: originId,
                decision_origin_hash: originHash,
                ...(relationDiagnostics !== undefined
                    ? { retirement_basis_relations: relationDiagnostics }
                    : {}),
            }
            : baseRecord;
        mkdirSync(storeDir, { recursive: true });
        appendFileSync(portalAuthorityEvidencePath(storeDir), `${JSON.stringify(persistedRecord)}\n`, "utf8");
    }
    catch {
        /* evidence side-channel must never affect the approval path */
    }
}
//# sourceMappingURL=evidence.js.map