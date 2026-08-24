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
import type { DeliveryEvidenceBasis } from "./evidence-basis.js";
export declare const AUTHORITY_DECISION_RELATION_RETIREMENT: "retire_model_position";
export declare const SHA256_HEX: RegExp;
/** Action-ground sources only. Re-delivery context must not mint "new grounds". */
export declare const ACTION_GROUND_SOURCES: readonly ["governed_task_spec", "allowed_file_names", "file_contents", "tool_retrieval"];
export type ObjectionStanding = "standing" | "retired" | "historical";
export type GroundsId = string | "unknown";
export type GroundsRelation = "same" | "new" | "unknown";
export type RetiredPositionRef = {
    readonly modelPositionId: string;
    readonly positionHash: string;
    readonly groundsId: GroundsId;
    readonly resolvingEvidenceIds: readonly string[];
    readonly retirementEnvelopeId?: string;
};
export type RetirementRequest = {
    readonly modelPositionId: string;
    readonly positionHash: string;
    readonly resolvingEvidenceIds: readonly string[];
    /** Currently standing objection identities on this gate. */
    readonly livePositionIds: readonly string[];
};
export type RetirementValidation = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: "empty_evidence" | "malformed_evidence_id" | "malformed_objection_id" | "wrong_objection";
};
export type IncomingClassification = "standing" | "retired_reassertion";
/**
 * Mechanical grounds identity for one challenge. Uses only the action-ground
 * P4 sources plus artifactId. Missing basis → "unknown" (do not resurrect).
 */
export declare function groundsIdFromBasis(artifactId: string, basis: DeliveryEvidenceBasis | undefined): GroundsId;
export declare function compareGrounds(retired: GroundsId, incoming: GroundsId): GroundsRelation;
export declare function validateRetirementRequest(req: RetirementRequest): RetirementValidation;
/**
 * A retirement envelope bound to O1 cannot be applied to O2.
 * Identity is the bound model_position_id, not prose similarity.
 */
export declare function retirementAppliesTo(retirement: Pick<RetiredPositionRef, "modelPositionId">, objectionId: string): boolean;
export declare function deriveStanding(objectionId: string, retirements: readonly Pick<RetiredPositionRef, "modelPositionId">[]): ObjectionStanding;
/**
 * Classify an incoming advisory against the retired set.
 *
 *   same model_position_id + no observably new grounds → retired_reassertion
 *   different id + same established grounds            → retired_reassertion
 *   unknown grounds on either side                     → retired_reassertion
 *   different id + observably different established
 *     grounds vs every retirement                      → standing (new objection)
 */
export declare function classifyIncomingAdvisory(incoming: {
    readonly modelPositionId: string;
    readonly groundsId: GroundsId;
}, retired: readonly Pick<RetiredPositionRef, "modelPositionId" | "groundsId">[]): IncomingClassification;
export declare function canonicalResolvingEvidenceIds(ids: readonly string[]): readonly string[];
//# sourceMappingURL=objection-retirement.d.ts.map