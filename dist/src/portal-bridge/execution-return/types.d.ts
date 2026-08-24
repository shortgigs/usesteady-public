/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - frozen wire types.
 *
 * Direction: Core -> Portal. These types describe the ONLY interface between the
 * two lanes: the `ucp.execution_return.v1` JSON payload. Core never imports
 * Portal code and Portal never imports Core code; this wire shape is the
 * contract (see docs/product/execution-return-bridge-contract-v1.md).
 *
 * Privacy (INV-ERB-P2): there is deliberately NO field for file contents or
 * diffs. The type system itself prevents content from ever being placed on the
 * wire - only resource paths + change-types + counts exist here.
 *
 * Evolution: additive only (new OPTIONAL fields). Any breaking change requires a
 * new schema id `ucp.execution_return.v2` and a v2 contract - never an in-place
 * edit of these types.
 */
/** Frozen schema discriminator. Literal type - any other value is a bug. */
export declare const EXECUTION_RETURN_SCHEMA: "ucp.execution_return.v1";
/**
 * Recommended cap on `affected_resources` entries (contract "Bounds & rules").
 * When a run touches more than this, the payload carries the first N and sets
 * `affected_resources_truncated: true` with the true count in
 * `affected_resources_total`.
 */
export declare const AFFECTED_RESOURCES_LIMIT = 200;
export type ExecutionOutcome = "success" | "failure" | "partial";
export type ApprovalMode = "per_step" | "break_glass";
export type ResourceChangeType = "create" | "update" | "delete" | "rename";
/**
 * Feature 2.2 — why `approved` / `rejected` / `skipped` were populated.
 * `explicit_human_decision` is allowed only when the construction path already
 * possesses that evidence. `not_available` means the path has no such evidence
 * and MUST report zero; it is not a claim that no decision occurred.
 */
export type DecisionCountAvailabilityBasis = "explicit_human_decision" | "not_available";
/**
 * Feature 2.2 — `executed: 0` with this basis means execution is NOT
 * ESTABLISHED BY THIS FIELD. It does not mean "did not execute".
 */
export type ExecutedCountBasis = "not_established";
/** Counts only - never per-step content (INV-ERB-P2). */
export type ExecutionReturnDecisionSummary = {
    readonly total_steps: number;
    readonly approved: number;
    readonly rejected: number;
    readonly executed: number;
    readonly skipped: number;
    /** true if the run used the audited break-glass escape hatch. */
    readonly break_glass: boolean;
    /** Additive Feature 2.2. Omitted on legacy V1 payloads. */
    readonly approved_basis?: DecisionCountAvailabilityBasis;
    readonly rejected_basis?: DecisionCountAvailabilityBasis;
    /**
     * Additive Feature 2.2. Feature 2.2 construction always emits
     * `not_established`. `executed: 0` is unknown-by-this-field, not
     * proof of non-execution.
     */
    readonly executed_basis?: ExecutedCountBasis;
    readonly skipped_basis?: DecisionCountAvailabilityBasis;
};
/**
 * Additive Feature 2.2 — executor/delivery self-report counts.
 * `accepted` may populate ONLY this summary, never `decision_summary.approved`
 * or `decision_summary.executed`. Existing V1 consumers may ignore this field.
 */
export type ExecutionReturnDeliveryReportSummary = {
    readonly basis: "executor_delivery_report";
    readonly total: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly skipped: number;
    readonly pending: number;
    readonly stopped: number;
    readonly other: number;
};
export type ExecutionReturnApprovalRecord = {
    readonly mode: ApprovalMode;
    readonly approver: string | null;
    readonly approved_at: string | null;
    /**
     * P1 authority carry (additive, optional): the hard evidence-status label for
     * the approver/approved_at values. `portal_signed_verified` is emitted ONLY
     * when Core verified a signed Portal authority assertion against a pinned
     * Portal key and the exact live gate; every other path (local y/n, --yes,
     * break-glass, handoff timestamps, unverifiable bridge decisions) is
     * `self_asserted`. `authority_assertion` preserves the verified assertion
     * verbatim so the Portal can re-verify offline.
     */
    readonly authority_status?: "portal_signed_verified" | "self_asserted";
    readonly authority_assertion?: unknown;
};
/** Path + change-type only. No contents, no diff (INV-ERB-P2). */
export type ExecutionReturnAffectedResource = {
    readonly path: string;
    readonly change_type: ResourceChangeType;
};
export type ExecutionReturnResumeTokenMeta = {
    readonly present: boolean;
    readonly resumable: boolean;
};
/**
 * The full decision chain is NOT transmitted in v1 (INV-ERB-P4). Core remains
 * the source of truth; the Portal stores a summary + counts and this reference
 * marker. `fetch` is always "on_demand" in v1.
 */
export type ExecutionReturnChainRef = {
    readonly available: boolean;
    readonly count: number;
    readonly fetch: "on_demand";
};
/**
 * Reference to the deterministic kernel-replay artifact Core persisted for this
 * run (kernel.v1). Like `chain_ref`, this is a REFERENCE only - the artifact body
 * and IR are never transmitted (INV-ERB-P2/P4). It asserts that Core recorded a
 * replayable artifact and verified its checksum at run time; it never implies the
 * Portal can replay.
 *
 *   reconstructable: true  => `checksum` is the non-empty content address
 *   reconstructable: false => `checksum` is null (e.g. failure/partial runs that
 *                             persist no kernel artifact today)
 */
export type ExecutionReturnReplayRef = {
    readonly reconstructable: boolean;
    readonly checksum: string | null;
};
/**
 * P0-57: optional chain-verification block. Additive OPTIONAL field. Carries the
 * ordered CONTENT-HASH ids of the decision chain plus the integrity digest so the
 * Portal can recompute the published root OFFLINE and assert a match. INV-ERB-P2 is
 * preserved: `entry_ids` are content addresses only - no envelope bodies, summaries,
 * timestamps, payloads, or diffs ride the wire. INV-ERB-P4 narrow clarification:
 * full envelope bodies remain on-demand; ids + digest are permitted (see contract).
 * Omitted from the wire when the chain is empty.
 */
export type ExecutionReturnChainVerification = {
    readonly entry_ids: readonly string[];
    readonly cumulative_hash: string;
    readonly merkle_root: string;
    readonly algorithm: "sha256";
};
/**
 * The frozen `ucp.execution_return.v1` wire payload (Core -> Portal).
 * Field names are snake_case to match the wire contract exactly.
 */
export type ExecutionReturnPayloadV1 = {
    readonly schema: typeof EXECUTION_RETURN_SCHEMA;
    readonly run_id: string;
    readonly ucp_root_id: string;
    readonly ucp_bundle_hash: string | null;
    readonly workflow_name: string | null;
    readonly outcome: ExecutionOutcome;
    readonly executed_at: string;
    readonly decision_summary: ExecutionReturnDecisionSummary;
    /**
     * Additive Feature 2.2. Executor/delivery self-report only. Omitted on
     * legacy V1 payloads; consumers may ignore it.
     */
    readonly delivery_report_summary?: ExecutionReturnDeliveryReportSummary;
    readonly approval_record: ExecutionReturnApprovalRecord;
    readonly affected_resources?: readonly ExecutionReturnAffectedResource[];
    readonly affected_resources_total?: number;
    readonly affected_resources_truncated?: boolean;
    readonly resume_token_meta?: ExecutionReturnResumeTokenMeta;
    readonly chain_ref: ExecutionReturnChainRef;
    /** Additive OPTIONAL (P0-55). Omitted when no replay artifact was recorded. */
    readonly replay_ref?: ExecutionReturnReplayRef;
    /** Additive OPTIONAL (P0-57). Omitted when the chain is empty. Ids + digest only. */
    readonly chain_verification?: ExecutionReturnChainVerification;
    /**
     * P6 V1 — independent outcome verification. Additive OPTIONAL.
     * Never derived from `outcome` / executor acceptance. `reality_verdict`
     * is omitted when the observation must not count as verified-against-reality.
     */
    readonly outcome_verification?: ExecutionReturnOutcomeVerification;
};
export type ExecutionReturnOutcomeVerification = {
    readonly status: "verified" | "disagreement" | "unknown" | "unverified";
    readonly executor_report: "accepted" | "failed";
    readonly observation: "agree" | "disagree" | "unknown" | "not_observed";
    readonly reality_verdict?: "agree" | "disagree" | "unknown";
    readonly intended_vs_actual?: "match" | "deviation" | "unknown";
};
//# sourceMappingURL=types.d.ts.map