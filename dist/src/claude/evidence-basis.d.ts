/**
 * src/claude/evidence-basis.ts
 *
 * P4 — Evidence-basis provenance for the Claude delivery path.
 *
 * ── What this module does ─────────────────────────────────────────────────────
 *
 *   Derives the factual evidence basis for a model challenge surface (advisory
 *   position, scope refusal) from the SYSTEM EXECUTION PATH — the deterministic
 *   delivery contract — never from what the model claims about itself.
 *
 *   For the V1 delivery path the system knows deterministically:
 *
 *     - the governed task specification IS supplied to the model input
 *       (category + summary + structured edit spec, derived from the persisted
 *       approval artifacts — A4);
 *     - allowed-file NAMES may be supplied (names only, never contents);
 *     - raw file contents are NOT supplied (the V1 adapters build the model
 *       input from the task specification only);
 *     - no in-process tool result is supplied; no read-file round-trip occurs
 *       (delivery is a single request/response);
 *     - on re-delivery after an advisory episode, previously persisted advisory
 *       positions ARE supplied verbatim.
 *
 *   A model saying "I inspected the file" must not upgrade its evidence status.
 *   Only this derivation sets it.
 *
 * ── Correspondence boundary (P8) ──────────────────────────────────────────────
 *
 *   "available_and_corresponded" means: correspondence is established between
 *   the persisted governance record and the CONSTRUCTED model input (M_SEND).
 *   The provider-side receiving boundary (M_RECV) is outside process
 *   observability and is NOT claimed here — see
 *   docs/research/P4_EVIDENCE_COMPREHENSION_CHARACTERIZATION_V1.md §P8.
 *
 * ── Zero authority ────────────────────────────────────────────────────────────
 *
 *   This module records facts. It never affects gating, consensus, delivery,
 *   or execution.
 */
import { type EvidenceSourceBasis, type EvidenceContradictionStatus, type ModelComprehensionStatus, type SystemStructuralDerivationV1 } from "../evidence-basis/types.js";
import type { ModelEvidenceBasisEnvelope, UCPEnvelope } from "../ucp/types.js";
import { type ClaudeDeliveryRequest } from "./types.js";
import type { MappedRetirementDiagnostic, RetirementBasisRelationV1 } from "../portal-bridge/authority-assertion/types.js";
/**
 * DeliveryEvidenceBasis — the system-derived evidence basis for one delivery.
 *
 * The same record is:
 *   1. persisted as the payload core of a `ucp.model_evidence_basis.v1`
 *      envelope (independent of the model's prose), and
 *   2. carried in-memory on `ModelAdvisoryRecord.evidenceBasis` so the
 *      Portal bridge can present the evidence boundary truthfully.
 *
 * `evidenceBackedContradiction` and `comprehension` are literal-only
 * "not_established" — see src/evidence-basis/types.ts.
 */
export type DeliveryEvidenceBasis = {
    readonly derivation: SystemStructuralDerivationV1;
    readonly sources: readonly EvidenceSourceBasis[];
    readonly evidenceBackedContradiction: EvidenceContradictionStatus;
    readonly comprehension: ModelComprehensionStatus;
};
/**
 * deriveDeliveryEvidenceBasis — derive the evidence basis for a delivery from
 * the deterministic delivery contract and the request the gate constructed.
 *
 * Pure. No I/O. Never reads the model's response — the basis is a fact about
 * what the SYSTEM supplied, established before/independently of any model
 * output.
 */
export declare function deriveDeliveryEvidenceBasis(request: ClaudeDeliveryRequest): DeliveryEvidenceBasis;
/**
 * AdvisoryEvidenceBasisLookup — whether a persisted `ucp.model_advisory.v1`
 * envelope has a linked system evidence-basis record.
 *
 *   established          — a `ucp.model_evidence_basis.v1` envelope parented to
 *                          the advisory envelope exists (P4-era record).
 *   legacy_unestablished — no linked basis record exists (pre-P4 record, or the
 *                          best-effort basis persist failed). Legacy records
 *                          remain readable but are NEVER silently upgraded:
 *                          their evidence basis is unestablished.
 */
export type AdvisoryEvidenceBasisLookup = {
    readonly status: "established";
    readonly envelope: ModelEvidenceBasisEnvelope;
} | {
    readonly status: "legacy_unestablished";
};
/**
 * classifyAdvisoryEvidenceBasis — look up the evidence-basis record linked to
 * a persisted advisory envelope.
 *
 * Navigation is refs-only: byParent[advisoryEnvelopeId], filtered by type
 * "ucp.model_evidence_basis.v1". No inference. Read-only.
 */
export declare function classifyAdvisoryEvidenceBasis(storeDir: string, advisoryEnvelopeId: string): AdvisoryEvidenceBasisLookup;
export type MappedRetirementEnvelopeReader = (storeDir: string, envelopeId: string) => UCPEnvelope<unknown> | null;
export declare function validateMappedRetirementEnvelopePair(input: {
    readonly storeDir: string;
    readonly relation: RetirementBasisRelationV1;
    readonly artifactId: string;
    readonly readEnvelopeById: MappedRetirementEnvelopeReader;
}): {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: MappedRetirementDiagnostic;
};
//# sourceMappingURL=evidence-basis.d.ts.map