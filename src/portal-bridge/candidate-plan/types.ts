/**
 * Candidate Plan Bridge (P.S1 - WORK_ITEM_LIFECYCLE_WIRING_V1 Lane P) - frozen
 * wire types.
 *
 * Direction: Core (Runtime) -> Portal. This is the THIRD Core->Portal
 * side-channel (after the Execution Return Bridge and the Decision Record
 * Bridge). It carries the candidate plan AS PRESENTED FOR APPROVAL - the
 * kernel's DRAFT understanding, persisted at draft time, structurally BEFORE
 * any ratification decision exists - so the Portal's lifecycle rail can render
 * the `candidate_plan` stage from a stored record instead of honest Unavailable.
 *
 * Authority (INV-WL-4): the stored plan is a ZERO-AUTHORITY AI record. Storing
 * or rendering it grants nothing; nothing reaches an executor without the
 * Governance Layer and human approval. There is deliberately no field an
 * executor or gate could consume as an instruction.
 *
 * Contract: this wire shape IS the contract (Core never imports Portal code
 * and vice versa; the Portal mirrors the validator in
 * lib/portal/candidatePlan/validate.ts). Any breaking change requires a new
 * schema id (`usesteady.candidate-plan/v2`), never an in-place edit.
 *
 * Hash parity (mirrors INV-DEC-012): `plan_hash` is sha256 over the canonical
 * serialization of the payload WITHOUT `plan_hash`, using the SAME
 * stableStringify as src/ucp/hashes.ts. The body is built UNDEFINED-FREE so it
 * survives the JSON round-trip and the Portal's recompute reproduces the digest.
 *
 * Privacy: no file contents, no diffs, no chain-of-thought, no prompts, no
 * tokens. Operations carry op kind + path ONLY. Model attribution, when the
 * producing surface recorded one, is permitted runtime metadata (INV-WL-6) -
 * it names a runtime participant inside the work item record, never artifact
 * authorship.
 */

/** Frozen schema discriminator. Literal type - any other value is a bug. */
export const CANDIDATE_PLAN_SCHEMA = "usesteady.candidate-plan/v1" as const;

/** Op kind + path only. No contents, no find/replace text, no hashes. */
export type CandidatePlanOperation = {
  readonly op_kind: string;
  readonly path: string;
};

/** One candidate plan exactly as the draft understanding carries it. */
export type CandidatePlanEntry = {
  readonly summary: string;
  /** Present only when the plan carries a structured executable op. */
  readonly operation?: CandidatePlanOperation;
};

export type CandidatePlanProvenanceLinks = {
  readonly run_id: string;
  readonly ucp_root_id?: string;
};

/**
 * The frozen `usesteady.candidate-plan/v1` wire payload (Core -> Portal).
 * Field names are snake_case to match the wire contract exactly. Optional
 * fields are OMITTED (never set to `undefined`) so the object is undefined-free
 * and the canonical hash survives the JSON round-trip.
 */
export type CandidatePlanPayloadV1 = {
  readonly schema: typeof CANDIDATE_PLAN_SCHEMA;
  /** The DRAFT record's content-addressed recordId. */
  readonly record_id: string;
  /** The draft's own createdAt - the moment the plan was presented (INV-PS1-1). */
  readonly created_at: string;
  readonly plan_hash: string;
  readonly intent_summary: {
    readonly human_request: string;
    readonly interpreted_summary?: string;
  };
  /** MUST be non-empty: a candidate-plan record with no plans is not emitted. */
  readonly plans: readonly CandidatePlanEntry[];
  /** UNKNOWN is first-class - preserved verbatim from the draft, never dropped. */
  readonly unknowns: readonly string[];
  /**
   * Optional runtime metadata (INV-WL-6): which model/runtime produced the
   * candidate understanding, when the producing surface recorded one. OMITTED
   * when unrecorded - honest absence, never a fabricated default.
   */
  readonly model_attribution?: string;
  readonly provenance_links: CandidatePlanProvenanceLinks;
};

/** The payload WITHOUT its `plan_hash` - the exact object the digest covers. */
export type CandidatePlanBody = Omit<CandidatePlanPayloadV1, "plan_hash">;
