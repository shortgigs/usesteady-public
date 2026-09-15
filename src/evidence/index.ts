/**
 * USESTEADY_OPENALEX_OBSERVER_BOUNDARY_VALIDATION_V1 — internal entry point.
 *
 * INTERNAL ONLY. This module is deliberately NOT re-exported from src/index.ts:
 * the evidence observer carries zero authority and must not become part of the
 * public engine surface. It is consumed by reviewer tooling and the boundary
 * cert, never by the workflow/constitution authority path.
 */

export type { EvidenceReference, EvidenceObservation, EvidenceSource } from "./types.js";
export {
  recordEvidenceObservation,
  loadEvidenceObservations,
  EVIDENCE_LEDGER_PATH_ENV,
} from "./observer-sink.js";
export { observeEvidence } from "./observe.js";
export {
  searchWorks,
  createOpenAlexSource,
  OPENALEX_SOURCE_ID,
  OPENALEX_API_KEY_ENV,
  OPENALEX_MAILTO_ENV,
  type OpenAlexFetch,
  type SearchOptions,
} from "./openalex-adapter.js";
