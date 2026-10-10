/**
 * Evidence-basis provenance — public API (P4).
 *
 * Shared factual vocabulary only. Surface-specific derivations live with
 * their surfaces (src/claude/evidence-basis.ts, src/friction/reviewer.ts).
 */

export {
  EVIDENCE_AVAILABILITY,
  SYSTEM_STRUCTURAL_DERIVATION_V1,
} from "./types.js";
export type {
  EvidenceAvailability,
  EvidenceSourceBasis,
  EvidenceContradictionStatus,
  ModelComprehensionStatus,
  SystemStructuralDerivationV1,
} from "./types.js";
