/**
 * src/claude/objection-retirement.ts
 *
 * P5 V1 — retirement of a specific structured model advisory by an authorized
 * human, linked to named resolving evidence. Pure. Zero authority of its own.
 *
 * What this is:
 *   O --retired_by_evidence--> R
 *   Standing is a read model over append-only retirement relations.
 *   Same model_position_id / same mechanical grounds cannot become standing
 *   again. Prose paraphrase cannot manufacture new grounds.
 *
 * What this is not:
 *   A belief engine. A semantic duplicate detector. An adjudication/K1 system.
 *   A claim that the objection is false. proceed_despite (that is P3).
 */
import { hashObject } from "../ucp/hashes.js";
export const AUTHORITY_DECISION_RELATION_RETIREMENT = "retire_model_position";
export const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Action-ground sources only. Re-delivery context must not mint "new grounds". */
export const ACTION_GROUND_SOURCES = [
    "governed_task_spec",
    "allowed_file_names",
    "file_contents",
    "tool_retrieval",
];
/**
 * Mechanical grounds identity for one challenge. Uses only the action-ground
 * P4 sources plus artifactId. Missing basis → "unknown" (do not resurrect).
 */
export function groundsIdFromBasis(artifactId, basis) {
    if (basis === undefined)
        return "unknown";
    const sources = basis.sources
        .filter((s) => ACTION_GROUND_SOURCES.includes(s.source))
        .map((s) => ({ source: s.source, availability: s.availability }))
        .sort((a, b) => a.source.localeCompare(b.source));
    if (sources.length === 0)
        return "unknown";
    if (sources.some((s) => s.availability === "unknown"))
        return "unknown";
    return hashObject({ artifactId, sources });
}
export function compareGrounds(retired, incoming) {
    if (retired === "unknown" || incoming === "unknown")
        return "unknown";
    return retired === incoming ? "same" : "new";
}
export function validateRetirementRequest(req) {
    if (req.resolvingEvidenceIds.length === 0) {
        return { ok: false, reason: "empty_evidence" };
    }
    for (const id of req.resolvingEvidenceIds) {
        if (!SHA256_HEX.test(id))
            return { ok: false, reason: "malformed_evidence_id" };
    }
    if (!SHA256_HEX.test(req.modelPositionId) || !SHA256_HEX.test(req.positionHash)) {
        return { ok: false, reason: "malformed_objection_id" };
    }
    if (!req.livePositionIds.includes(req.modelPositionId)) {
        return { ok: false, reason: "wrong_objection" };
    }
    return { ok: true };
}
/**
 * A retirement envelope bound to O1 cannot be applied to O2.
 * Identity is the bound model_position_id, not prose similarity.
 */
export function retirementAppliesTo(retirement, objectionId) {
    return retirement.modelPositionId === objectionId;
}
export function deriveStanding(objectionId, retirements) {
    const retired = retirements.some((r) => r.modelPositionId === objectionId);
    return retired ? "retired" : "standing";
}
/**
 * Classify an incoming advisory against the retired set.
 *
 *   same model_position_id + no observably new grounds → retired_reassertion
 *   different id + same established grounds            → retired_reassertion
 *   unknown grounds on either side                     → retired_reassertion
 *   different id + observably different established
 *     grounds vs every retirement                      → standing (new objection)
 */
export function classifyIncomingAdvisory(incoming, retired) {
    if (retired.length === 0)
        return "standing";
    const exact = retired.find((r) => r.modelPositionId === incoming.modelPositionId);
    if (exact !== undefined) {
        return compareGrounds(exact.groundsId, incoming.groundsId) === "new"
            ? "standing"
            : "retired_reassertion";
    }
    if (incoming.groundsId === "unknown")
        return "retired_reassertion";
    for (const r of retired) {
        const rel = compareGrounds(r.groundsId, incoming.groundsId);
        if (rel === "unknown" || rel === "same")
            return "retired_reassertion";
    }
    return "standing";
}
export function canonicalResolvingEvidenceIds(ids) {
    return [...ids].sort();
}
//# sourceMappingURL=objection-retirement.js.map