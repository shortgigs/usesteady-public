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

import {
  SYSTEM_STRUCTURAL_DERIVATION_V1,
  type EvidenceSourceBasis,
  type EvidenceContradictionStatus,
  type ModelComprehensionStatus,
  type SystemStructuralDerivationV1,
} from "../evidence-basis/types.js";
import { loadIndex, getEnvelopeById } from "../ucp/persistence/index.js";
import { recomputeEnvelopeIdentity } from "../ucp/envelope.js";
import { hashObject } from "../ucp/hashes.js";
import type { ModelEvidenceBasisEnvelope, UCPEnvelope } from "../ucp/types.js";
import {
  canonicalModelAdvisoryEvent,
  type ClaudeDeliveryRequest,
  type ModelAdvisoryPosition,
} from "./types.js";
import type {
  MappedRetirementDiagnostic,
  RetirementBasisRelationV1,
} from "../portal-bridge/authority-assertion/types.js";

// ─── The structured basis record ─────────────────────────────────────────────

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
  readonly derivation:                 SystemStructuralDerivationV1;
  readonly sources:                    readonly EvidenceSourceBasis[];
  readonly evidenceBackedContradiction: EvidenceContradictionStatus;
  readonly comprehension:              ModelComprehensionStatus;
};

// ─── Derivation (pure, system-side only) ──────────────────────────────────────

/**
 * deriveDeliveryEvidenceBasis — derive the evidence basis for a delivery from
 * the deterministic delivery contract and the request the gate constructed.
 *
 * Pure. No I/O. Never reads the model's response — the basis is a fact about
 * what the SYSTEM supplied, established before/independently of any model
 * output.
 */
export function deriveDeliveryEvidenceBasis(
  request: ClaudeDeliveryRequest,
): DeliveryEvidenceBasis {
  const artifact = request.artifact;

  const sources: EvidenceSourceBasis[] = [
    {
      source:       "governed_task_spec",
      availability: "available_and_corresponded",
      detail:
        "Task category, summary, and structured edit specification were supplied " +
        "to the constructed model input, derived deterministically from the " +
        "persisted approval artifacts.",
    },
    artifact.allowedFiles.length > 0
      ? {
          source:       "allowed_file_names",
          availability: "available_and_corresponded",
          detail:
            `${artifact.allowedFiles.length} allowed file name(s) were listed in the ` +
            "constructed model input. Names only — never contents.",
        }
      : {
          source:       "allowed_file_names",
          availability: "not_provided",
          detail:       "No allowed-file list was supplied to the model input.",
        },
    {
      source:       "file_contents",
      availability: "not_provided",
      detail:
        "No file contents were included in the model input. The V1 delivery " +
        "contract builds the model input from the governed task specification only.",
    },
    {
      source:       "tool_retrieval",
      availability: "not_provided",
      detail:
        "No in-process tool execution or read-file round-trip occurred; " +
        "delivery is a single request/response.",
    },
  ];

  if (request.priorAdvisories && request.priorAdvisories.length > 0) {
    sources.push({
      source:       "prior_advisory_positions",
      availability: "available_and_corresponded",
      detail:
        `${request.priorAdvisories.length} previously persisted advisory position(s) ` +
        "were included verbatim in the re-delivery input.",
    });
  }

  if (request.retiredAdvisories && request.retiredAdvisories.length > 0) {
    sources.push({
      source:       "retired_positions",
      availability: "available_and_corresponded",
      detail:
        `${request.retiredAdvisories.length} retired model position(s) were ` +
        "included as non-standing context with named resolving evidence. " +
        "This source is not an action ground.",
    });
  }

  return {
    derivation:                  SYSTEM_STRUCTURAL_DERIVATION_V1,
    sources,
    evidenceBackedContradiction: "not_established",
    comprehension:               "not_established",
  };
}

// ─── Legacy classification (attack: silent upgrade) ──────────────────────────

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
export type AdvisoryEvidenceBasisLookup =
  | { readonly status: "established";          readonly envelope: ModelEvidenceBasisEnvelope }
  | { readonly status: "legacy_unestablished" };

/**
 * classifyAdvisoryEvidenceBasis — look up the evidence-basis record linked to
 * a persisted advisory envelope.
 *
 * Navigation is refs-only: byParent[advisoryEnvelopeId], filtered by type
 * "ucp.model_evidence_basis.v1". No inference. Read-only.
 */
export function classifyAdvisoryEvidenceBasis(
  storeDir:           string,
  advisoryEnvelopeId: string,
): AdvisoryEvidenceBasisLookup {
  const index    = loadIndex(storeDir);
  const childIds = index.byParent[advisoryEnvelopeId] ?? [];

  for (const id of childIds) {
    const env = getEnvelopeById(storeDir, id);
    if (env === null) continue;
    if (env.type === "ucp.model_evidence_basis.v1") {
      return { status: "established", envelope: env as ModelEvidenceBasisEnvelope };
    }
  }

  return { status: "legacy_unestablished" };
}

export type MappedRetirementEnvelopeReader = (
  storeDir: string,
  envelopeId: string,
) => UCPEnvelope<unknown> | null;

export function validateMappedRetirementEnvelopePair(input: {
  readonly storeDir: string;
  readonly relation: RetirementBasisRelationV1;
  readonly artifactId: string;
  readonly readEnvelopeById: MappedRetirementEnvelopeReader;
}):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MappedRetirementDiagnostic } {
  let o: UCPEnvelope<unknown> | null;
  let e: UCPEnvelope<unknown> | null;
  try {
    o = input.readEnvelopeById(
      input.storeDir,
      input.relation.model_position.position_hash,
    );
  } catch {
    return { ok: false, code: "mapped_store_unavailable" };
  }
  if (o === null) return { ok: false, code: "mapped_o_reference_absent" };
  if (o.id !== input.relation.model_position.position_hash) {
    return { ok: false, code: "mapped_o_reference_corrupt" };
  }
  try {
    e = input.readEnvelopeById(
      input.storeDir,
      input.relation.resolving_evidence.evidence_basis_id,
    );
  } catch {
    return { ok: false, code: "mapped_store_unavailable" };
  }
  if (e === null) return { ok: false, code: "mapped_e_reference_absent" };
  if (e.id !== input.relation.resolving_evidence.evidence_basis_id) {
    return { ok: false, code: "mapped_e_reference_corrupt" };
  }

  if (o.type !== "ucp.model_advisory.v1") {
    return { ok: false, code: "mapped_o_reference_corrupt" };
  }
  const oIdentity = recomputeEnvelopeIdentity(o);
  if (oIdentity.id !== o.id || oIdentity.hash !== o.hash) {
    return { ok: false, code: "mapped_o_reference_corrupt" };
  }
  const op = o.payload as Partial<{
    artifactId: string;
    modelPositionId: string;
    positionKind: ModelAdvisoryPosition["kind"];
    explanation: string;
    runtime: string;
    model: string;
  }>;
  if (
    typeof op.artifactId !== "string" ||
    typeof op.modelPositionId !== "string" ||
    typeof op.positionKind !== "string" ||
    typeof op.explanation !== "string" ||
    typeof op.runtime !== "string" ||
    typeof op.model !== "string" ||
    hashObject(canonicalModelAdvisoryEvent({
      artifactId: op.artifactId,
      kind: op.positionKind,
      explanation: op.explanation,
      runtime: op.runtime,
      model: op.model,
    })) !== input.relation.model_position.model_position_id ||
    op.modelPositionId !== input.relation.model_position.model_position_id ||
    op.artifactId !== input.artifactId
  ) {
    return { ok: false, code: "mapped_o_reference_corrupt" };
  }

  if (e.type !== "ucp.model_evidence_basis.v1") {
    return { ok: false, code: "mapped_e_reference_corrupt" };
  }
  const eIdentity = recomputeEnvelopeIdentity(e);
  const ep = e.payload as Partial<{
    artifactId: string;
    subjectId: string;
    subjectKind: string;
  }>;
  if (
    eIdentity.id !== e.id ||
    eIdentity.hash !== e.hash ||
    e.hash !== input.relation.resolving_evidence.evidence_basis_hash ||
    e.refs?.parentId !== o.id ||
    ep.subjectKind !== "model_advisory" ||
    ep.subjectId !== input.relation.model_position.model_position_id ||
    ep.artifactId !== input.artifactId ||
    ep.artifactId !== op.artifactId
  ) {
    return { ok: false, code: "mapped_e_reference_corrupt" };
  }
  return { ok: true };
}
