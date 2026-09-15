/**
 * USESTEADY_OPENALEX_OBSERVER_BOUNDARY_VALIDATION_V1 — evidence observer types.
 *
 * These types model EXTERNAL scholarly evidence as a carried-alongside OBSERVER,
 * never as authority. Per USESTEADY_OPENALEX_CHARACTERIZATION_V1:
 *
 *   External knowledge may observe, annotate, and inform.
 *   It may never ratify, approve, become canonical, modify the Decision Basis,
 *   enter canonicalBasisPayload(), or influence execution authority.
 *
 * Nothing in this module imports the Constitution (decision-basis / fingerprint /
 * approval-record). The boundary is structural: an EvidenceObservation references
 * a run ONLY by its opaque `workflowRunId` string and lives in a separate sink.
 *
 * Immutability is achieved by SNAPSHOTTING each reference at capture time
 * (`accessedAt`), not by tracking the mutable external index. A snapshot never
 * changes when OpenAlex later merges, corrects, or re-IDs a record.
 */

/**
 * One scholarly reference, snapshotted at capture time.
 *
 * Raw metadata only. `citedByCount` is preserved as a neutral fact and is NEVER
 * used to rank, score, weight, or select — the adapter preserves source order and
 * performs no reordering (see openalex-adapter.ts). Presenting "cited a lot" as
 * importance or correctness is an explicit non-goal of the characterization.
 */
export type EvidenceReference = {
  /**
   * Stable source identifier, e.g. "openalex". Names the EvidenceSource
   * implementation that produced this reference. OpenAlex is the first source,
   * not the schema — arXiv/Crossref/PubMed/private evidence reuse this contract.
   */
  readonly source: string;
  /** Source-native id, e.g. "https://openalex.org/W2741809807" for OpenAlex. */
  readonly sourceId: string;
  readonly title: string | null;
  readonly publicationYear: number | null;
  readonly doi: string | null;
  /** Neutral metadata — never used for ranking/scoring. */
  readonly citedByCount: number | null;
  /** The source URL the reference was read from. */
  readonly sourceUrl: string;
  /** ISO-8601 snapshot time — the immutability anchor. */
  readonly accessedAt: string;
};

/**
 * A set of references a reviewer consulted at decision time for one run.
 *
 * Keyed by `workflowRunId` (opaque string). It is NOT an ApprovalRecord and NOT
 * a DecisionBasis class. It carries zero authority.
 */
export type EvidenceObservation = {
  readonly workflowRunId: string;
  /** The query text used to discover references (provenance of the lookup). */
  readonly query: string;
  readonly capturedAt: string;
  readonly references: readonly EvidenceReference[];
};

/**
 * A pluggable, read-only evidence source. OpenAlex is the FIRST implementation,
 * not the schema: adding arXiv, Crossref, PubMed, or private evidence later is a
 * new implementation of this interface, not a change to the observer contract.
 *
 * A source carries ZERO authority. It only discovers references; it cannot reach
 * the Decision Basis, canonicalBasisPayload(), the fingerprint, an ApprovalRecord,
 * or any execution gate. The observer orchestration (observeEvidence) is the only
 * consumer, and it is never wired into a decision path.
 */
export interface EvidenceSource {
  /** Stable id for this source, mirrored into EvidenceReference.source. */
  readonly id: string;
  /**
   * Read-only discovery. Returns references in source order (NO ranking), capped
   * to `maxResults` when provided. Implementations may throw on hard failure;
   * observeEvidence swallows that to stay best-effort.
   */
  search(query: string, maxResults?: number): Promise<readonly EvidenceReference[]>;
}
