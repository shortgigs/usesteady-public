/**
 * Portal Authority Assertions V1/V2 — durable evidence writer (Core).
 *
 * Appends one JSON line per consumed Portal-mediated authority assertion to
 * `<storeDir>/portal-authority-evidence.jsonl`. The assertion is preserved
 * VERBATIM (never collapsed back into a plain approver string) so a later
 * verifier can independently establish: this exact assertion was signed by the
 * trusted Portal authority key and bound to this exact governed decision.
 *
 * Best-effort and never-throw: evidence persistence must never block, advance,
 * or approve anything (same posture as the bridge itself).
 */
export declare const PORTAL_AUTHORITY_EVIDENCE_FILE = "portal-authority-evidence.jsonl";
export type PortalAuthorityEvidenceRecord = {
    readonly recorded_at: string;
    readonly path: "pending_approval" | "governed_handoff";
    readonly verification: "portal_signed_verified" | "self_asserted" | "verification_failed";
    readonly reason?: string;
    /** Denormalized from the assertion payload when parseable (diagnostic). */
    readonly decision_id?: string | null;
    readonly organization_id?: string | null;
    readonly run_id?: string | null;
    readonly thread_id?: string | null;
    readonly step_index?: number | null;
    readonly decision?: string | null;
    readonly decided_at?: string | null;
    readonly authority_subject_id?: string | null;
    readonly key_id?: string | null;
    /** Feature 3.1 v2-only diagnostic fields; never authority inputs. */
    readonly origin_id?: string;
    readonly decision_origin_hash?: string;
    /**
     * P3 Phase 2 (diagnostic denormalization): the signed supersession relation
     * and the exact position refs, when the assertion carried them. Both facts —
     * the model's position and the human's supersession — survive independently;
     * the full advisory evidence lives in the ucp.model_advisory.v1 envelope.
     */
    readonly decision_relation?: string | null;
    readonly model_position_ids?: readonly string[];
    readonly retirement_basis_relations?: readonly {
        readonly model_position_id: string;
        readonly position_hash: string;
        readonly evidence_basis_id: string;
        readonly evidence_basis_hash: string;
    }[];
    /** The full assertion envelope, preserved verbatim. */
    readonly assertion?: unknown;
};
export declare function portalAuthorityEvidencePath(storeDir: string): string;
export declare function appendPortalAuthorityEvidence(storeDir: string, record: PortalAuthorityEvidenceRecord): void;
//# sourceMappingURL=evidence.d.ts.map