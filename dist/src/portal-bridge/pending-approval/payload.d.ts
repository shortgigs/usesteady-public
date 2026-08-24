/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - pure payload
 * builder + validator for the Core -> Portal emit.
 *
 * Direction: Core -> Portal `POST /api/v1/pending-approvals` when a run reaches a
 * pre-execution approval gate. This module owns the frozen `ucp.pending_approval.v1`
 * wire shape and is PURE: no network, no filesystem, no clock, no env reads. The
 * opt-in resolution, the HTTPS POST, and the gate hook are later PRs - kept out of
 * this unit so the wire shape can be tested in isolation (mirrors the sibling
 * EXECUTION_RETURN_BRIDGE_V1 build-payload module).
 *
 * Authority: this bridge is a remote INPUT to Core's existing approval gate, never
 * a new authority and never an executor (INV-LA-AUTH1/AUTH4). Building a payload
 * publishes "a gate is open"; it does not run, approve, or skip anything.
 *
 * Privacy (INV-PAB-P2 / INV-LA-EMIT1): there is deliberately NO field for file
 * contents or diffs. The type system itself prevents content from reaching the
 * wire - only a SYSTEM WILL summary, resource paths + change-types, counts, and a
 * risk band exist here. Resources are assumed already redacted on the machine
 * before they reach this builder.
 *
 * Evolution: additive only (new OPTIONAL fields). Any breaking change requires a
 * new schema id `ucp.pending_approval.v2` and a v2 contract - never an in-place
 * edit of these types.
 *
 * Frozen wire contract: PENDING_APPROVAL_BRIDGE_V1
 * (docs/product/pending-approval-bridge-contract-v1.md, authored in usesteady-ops).
 */
/** Frozen schema discriminator. Literal type - any other value is a bug. */
export declare const PENDING_APPROVAL_SCHEMA: "ucp.pending_approval.v1";
/**
 * Recommended cap on `affected_resources` entries (contract "Bounds & rules").
 * When a gate touches more than this, the payload carries the first N and sets
 * `affected_resources_truncated: true` with the true count in
 * `affected_resources_total`. Defined locally (not imported from the return
 * bridge) so the two bridges stay independent; the contract recommends 200 for
 * each. Matches the Lane B (Portal) cap of the same name.
 */
export declare const PENDING_AFFECTED_RESOURCES_LIMIT = 200;
export type PendingApprovalRisk = "low" | "medium" | "high";
export type PendingActionType = "create" | "update" | "delete" | "rename" | "other";
export type ResourceChangeType = "create" | "update" | "delete" | "rename";
/** Closed enum of structured model advisory kinds (Core-stamped, model-selected). */
export type PendingModelAdvisoryKind = "warning" | "recommend_against" | "uncertainty" | "alternative";
export declare const PENDING_MODEL_ADVISORY_KINDS: readonly PendingModelAdvisoryKind[];
/** Max advisory positions carried on one gate. */
export declare const PENDING_MODEL_ADVISORIES_LIMIT = 8;
/** Max characters per advisory explanation on the wire. */
export declare const PENDING_MODEL_ADVISORY_EXPLANATION_LIMIT = 4000;
/**
 * Closed availability vocabulary for one evidence source on the wire. Mirrors
 * src/evidence-basis/types.ts (Core) — duplicated here so the bridge stays
 * dependency-free; the two MUST NOT drift apart.
 */
export declare const PENDING_EVIDENCE_AVAILABILITY: readonly ["available_and_corresponded", "not_provided", "partial", "retrieval_failed", "correspondence_not_established", "unknown"];
export type PendingEvidenceAvailability = (typeof PENDING_EVIDENCE_AVAILABILITY)[number];
/** Max evidence sources carried per advisory. */
export declare const PENDING_EVIDENCE_SOURCES_LIMIT = 8;
/** Max characters per evidence-source detail note on the wire. */
export declare const PENDING_EVIDENCE_DETAIL_LIMIT = 280;
/**
 * One evidence source and its system-established availability (wire shape).
 * `detail` is a short factual SYSTEM note (counts, never file contents or
 * model prose).
 */
export type PendingModelEvidenceBasisSource = {
    readonly source: string;
    readonly availability: PendingEvidenceAvailability;
    readonly detail?: string;
};
/**
 * The SYSTEM's factual record of what evidence basis was available to the
 * model for one advisory position (P4). Derived from the deterministic
 * delivery contract BEFORE the model was called — never from the model's
 * response prose.
 *
 * CLAIM BOUNDARY (wire-enforced): `evidence_backed_contradiction` and
 * `comprehension` are literal "not_established". "available_and_corresponded"
 * asserts supply/correspondence at the application boundary only — never
 * comprehension, reliance, or provider-side consumption. Validation fails
 * closed on any other value: the wire cannot carry an overclaim.
 */
export type PendingModelEvidenceBasis = {
    readonly derivation: "system_structural_v1";
    readonly sources: readonly PendingModelEvidenceBasisSource[];
    readonly evidence_backed_contradiction: "not_established";
    readonly comprehension: "not_established";
};
/**
 * One structured model advisory position carried on a pending-approval gate.
 *
 *   model_position_id — content-addressed id: hashObject over the canonical
 *                       advisory event ({ artifactId, explanation, kind, model,
 *                       runtime }). Identical to the value embedded in the
 *                       persisted ucp.model_advisory.v1 payload.
 *   position_hash     — id of the persisted ucp.model_advisory.v1 evidence
 *                       envelope (the exact preserved record).
 *   evidence_basis    — OPTIONAL (P4). The system-derived evidence basis for
 *                       this position. Absent for legacy (pre-P4) advisories —
 *                       NEVER synthesized after the fact.
 *
 * Advisory content is model-authored and preserved verbatim. It is displayed
 * to the human beside SYSTEM WILL; it never decides anything (zero authority).
 */
export type PendingApprovalModelAdvisory = {
    readonly model_position_id: string;
    readonly position_hash: string;
    readonly kind: PendingModelAdvisoryKind;
    readonly explanation: string;
    readonly evidence_basis?: PendingModelEvidenceBasis;
    /**
     * OPTIONAL (P5) — id of the persisted ucp.model_evidence_basis.v1 envelope.
     * Named resolving evidence when the human retires this position.
     */
    readonly evidence_basis_id?: string;
    readonly evidence_basis_ref?: {
        readonly evidence_basis_id: string;
        readonly evidence_basis_hash: string;
    };
};
/** Path + change-type only. No contents, no diff (INV-PAB-P2). */
export type PendingAffectedResource = {
    readonly path: string;
    readonly change_type: ResourceChangeType;
};
/** What WILL run if the human approves - a summary only, never file contents. */
export type PendingApprovalSystemWill = {
    readonly summary: string;
    readonly action_type: PendingActionType;
    readonly affected_resources?: readonly PendingAffectedResource[];
    readonly affected_resources_total?: number;
    readonly affected_resources_truncated?: boolean;
};
/**
 * The frozen `ucp.pending_approval.v1` wire payload (Core -> Portal).
 * Field names are snake_case to match the wire contract exactly.
 */
export type PendingApprovalPayloadV1 = {
    readonly schema: typeof PENDING_APPROVAL_SCHEMA;
    readonly run_id: string;
    readonly step_index: number;
    readonly ucp_root_id: string | null;
    readonly workflow_name: string | null;
    readonly system_will: PendingApprovalSystemWill;
    readonly risk: PendingApprovalRisk;
    readonly requested_by: string | null;
    readonly requested_at: string;
    /** Optional. Omitted from the wire when 0/absent (= no TTL). */
    readonly ttl_seconds?: number;
    /** Optional. Present and true only to retract an already-emitted gate. */
    readonly withdraw?: boolean;
    /**
     * OPTIONAL (P3 Phase 2, additive) — structured model advisory positions
     * attached to this gate. Present only on a re-opened gate after the model
     * emitted advisory position(s) and the task parked for a human supersession
     * decision. Omitted entirely for ordinary gates.
     */
    readonly model_advisories?: readonly PendingApprovalModelAdvisory[];
    /**
     * OPTIONAL (P3 Phase 2, additive) — gate emission cycle for this
     * (run_id, step_index): 0 = the ordinary approval gate; 1+ = the gate was
     * re-opened after model advisory episode N. Omitted when 0. The Portal keys
     * gate identity on (organization_id, run_id, step_index, gate_cycle).
     */
    readonly gate_cycle?: number;
};
/**
 * Normalized, lane-internal input. Camel-case (Core convention); the builder maps
 * it to the snake_case wire shape. Resources must already be redacted on the
 * machine (INV-PAB-P3 / INV-LA-EMIT1) before this call.
 */
export type PendingApprovalInput = {
    readonly runId: string;
    /** 0-based gate index within the run. */
    readonly stepIndex: number;
    readonly ucpRootId?: string | null;
    readonly workflowName?: string | null;
    /** Human-readable SYSTEM WILL line - no file contents. */
    readonly summary: string;
    readonly actionType: PendingActionType;
    /** Already redacted/allowlisted on the machine before this call. */
    readonly affectedResources?: readonly PendingAffectedResource[];
    readonly risk: PendingApprovalRisk;
    readonly requestedBy?: string | null;
    /** ISO-8601, Core clock (gate-open time; ordering authority - INV-PAB-I4). */
    readonly requestedAt: string;
    /** 0/absent/negative => no TTL (omitted from the wire). */
    readonly ttlSeconds?: number | null;
    /**
     * true builds a withdraw payload that retracts a previously-emitted gate for
     * the same `(run_id, step_index)` (INV-LA-WD1). The wire shape is uniform: a
     * withdraw still carries the full gate fields; the Portal only acts on the flag.
     */
    readonly withdraw?: boolean;
    /**
     * OPTIONAL (P3 Phase 2) — structured model advisory positions to surface
     * beside SYSTEM WILL on the approval surface. Mapped verbatim (camel →
     * snake) onto the wire; content was validated and durably persisted
     * upstream (ucp.model_advisory.v1) before this call.
     */
    readonly modelAdvisories?: readonly {
        readonly modelPositionId: string;
        readonly positionHash: string;
        readonly kind: PendingModelAdvisoryKind;
        readonly explanation: string;
        /** Core-local expected binding only; never emitted on the Portal wire. */
        readonly artifactId?: string;
        /**
         * OPTIONAL (P4) — system-derived evidence basis for this position,
         * carried verbatim from the ModelAdvisoryRecord. Absent for legacy
         * (pre-P4) advisories; never synthesized at the bridge.
         */
        readonly evidenceBasis?: {
            readonly derivation: "system_structural_v1";
            readonly sources: readonly {
                readonly source: string;
                readonly availability: PendingEvidenceAvailability;
                readonly detail?: string;
            }[];
            readonly evidenceBackedContradiction: "not_established";
            readonly comprehension: "not_established";
        };
        readonly evidenceBasisId?: string;
        readonly evidenceBasisRef?: {
            readonly evidenceBasisId: string;
            readonly evidenceBasisHash: string;
        };
    }[];
    /**
     * OPTIONAL (P3 Phase 2) — gate emission cycle. Omit/0 for ordinary gates;
     * >= 1 when the gate is re-opened after a model advisory episode.
     */
    readonly gateCycle?: number;
};
/**
 * Build the frozen wire payload from normalized input.
 *
 * Bounds rule (contract "Bounds & rules"): when `affectedResources` exceeds
 * PENDING_AFFECTED_RESOURCES_LIMIT, only the first N are carried,
 * `affected_resources_truncated` is true, and `affected_resources_total` holds the
 * true pre-truncation count.
 */
export declare function buildPendingApprovalPayload(input: PendingApprovalInput): PendingApprovalPayloadV1;
export type PayloadValidation = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};
/**
 * Fail-closed validation. The transport step MUST call this before POSTing and
 * MUST NOT send when `ok === false`. It mirrors the Lane B (Portal) acceptance
 * contract (`validatePendingApprovalPayload`) so a payload this function accepts
 * is one the Portal endpoint will accept on type grounds (auth + idempotency are
 * separate, server-side concerns). Required fields - including system_will/risk/
 * requested_at - are required even for a withdraw, matching the Portal.
 */
export declare function validatePendingApprovalPayload(payload: PendingApprovalPayloadV1): PayloadValidation;
//# sourceMappingURL=payload.d.ts.map