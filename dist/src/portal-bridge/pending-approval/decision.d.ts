/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - pure parser +
 * interpreter for the Portal -> Core decision poll.
 *
 * Direction: Portal -> Core, returned by
 * `GET /api/v1/pending-approvals/decisions?run_id=...`, which Core polls while a
 * gate is open. This module owns the frozen `ucp.approval_decision.v1` read side
 * and is PURE: no network, no clock-dependence beyond a caller-supplied "now" is
 * needed (none is - the Portal already resolves TTL/expiry server-side), no
 * filesystem, no env. The poll loop and the gate enforcement are later PRs.
 *
 * Authority (the crux): a polled `approved` is a remote APPROVAL INPUT, not an
 * execution command. `interpretDecision` returns a DIRECTIVE describing what Core
 * should do; it never executes. On `approved` the directive is `approved`, and
 * the caller MUST still re-validate eligibility at Core's own gate before running
 * the step (INV-LA-AUTH2). Silence/absence is never approval - it maps to `wait`,
 * and the poll-loop's own wait-bound (a later PR) degrades to local approval, not
 * to silent execution (INV-LA-AUTH3).
 *
 * Frozen wire contract: PENDING_APPROVAL_BRIDGE_V1
 * (docs/product/pending-approval-bridge-contract-v1.md, authored in usesteady-ops).
 */
import type { RetirementBasisRelationV1 } from "../authority-assertion/types.js";
/** Frozen schema discriminator. Literal type - any other value is a bug. */
export declare const APPROVAL_DECISION_SCHEMA: "ucp.approval_decision.v1";
export type ApprovalDecisionStatus = "pending" | "approved" | "rejected" | "expired" | "withdrawn";
export type ApprovalDecisionVerb = "approve" | "reject";
/** One gate's current status, as reported by the Portal. */
export type ApprovalDecisionEntry = {
    readonly step_index: number;
    readonly status: ApprovalDecisionStatus;
    /** Present iff status is approved/rejected; null otherwise. */
    readonly decision: ApprovalDecisionVerb | null;
    readonly decided_at: string | null;
    readonly decided_by: string | null;
    /**
     * P1 authority carry (additive, optional): the Portal gate row id and the
     * signed `usesteady.authority_assertion.v1` envelope. Both are passed through
     * UNVERIFIED here — authority verification lives in
     * `src/portal-bridge/authority-assertion/` and runs before the values may be
     * treated as authenticated provenance.
     */
    readonly id?: string | null;
    readonly authority_assertion?: unknown;
    /**
     * P3 Phase 2 (additive, optional): which gate emission cycle this entry
     * describes (0 = ordinary gate; 1+ = re-opened after a model advisory
     * episode). Absent on Portals unaware of the P3 extension.
     */
    readonly gate_cycle?: number;
    /**
     * P3 Phase 2 (additive, optional): explicit decision relation. Present and
     * "proceed_despite_model_position" only when the human chose the explicit
     * supersession control on an advisory gate. Plain approve is never
     * recorded as a supersession (it is `null`/absent).
     */
    readonly decision_relation?: string | null;
    /**
     * P5 V1 (additive, optional): named resolving evidence ids when the
     * decision_relation is retire_model_position.
     */
    readonly resolving_evidence_ids?: readonly string[] | null;
    readonly retirement_basis_relations?: readonly RetirementBasisRelationV1[] | null;
};
/** The frozen `ucp.approval_decision.v1` wire body (Portal -> Core). */
export type ApprovalDecisionResponseV1 = {
    readonly schema: typeof APPROVAL_DECISION_SCHEMA;
    readonly run_id: string;
    readonly decisions: readonly ApprovalDecisionEntry[];
};
export type DecisionParseResult = {
    readonly ok: true;
    readonly value: ApprovalDecisionResponseV1;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};
/**
 * What Core should do for a gate, derived purely from the polled status. This is
 * a recommendation, NOT an action - the poll loop / gate enforcement (later PRs)
 * carry it out. Status is authoritative (the contract drives Core action off the
 * `status` field).
 *
 *   wait           - still pending (or no entry yet): keep the step blocked, keep
 *                    polling within Core's wait bound (INV-LA-POLL2).
 *   approved       - remote approve received. NECESSARY, NOT SUFFICIENT: the
 *                    caller must re-validate eligibility at Core's own gate before
 *                    proceeding (INV-LA-AUTH2/ENF1).
 *   rejected       - remote reject: reject the step at Core's gate (INV-LA-ENF2).
 *   fallback_local - no-decision (TTL expired): degrade to the local approval flow;
 *                    never auto-approve (INV-LA-AUTH3/ENF3).
 *   withdrawn      - Core itself retracted this gate; reconcile locally, no remote
 *                    decision to apply (status-handling table, wire contract).
 */
export type DecisionDirective = {
    readonly kind: "wait";
} | {
    readonly kind: "approved";
} | {
    readonly kind: "rejected";
} | {
    readonly kind: "fallback_local";
    readonly reason: "expired";
} | {
    readonly kind: "withdrawn";
};
/**
 * Fail-closed parse of an untrusted poll response body. Returns `ok: false` with
 * reasons for anything malformed - the poll loop treats a parse failure like an
 * unreachable Portal (eventually falling back to local approval, never approving).
 * Unknown fields are ignored (forward-compatible, additive-evolution contract).
 */
export declare function parseApprovalDecisionResponse(body: unknown): DecisionParseResult;
/**
 * Find the gate entry for a given 0-based step index, or null when the run's
 * decision list does not (yet) include it. A missing entry is "not decided yet",
 * which `interpretDecision` maps to `wait` (never to approval).
 *
 * When multiple entries exist for one step (P3 gate cycles), this returns the
 * entry with the HIGHEST gate_cycle — the latest gate emission is the one whose
 * decision the caller needs. Legacy (single-entry) runs are unaffected.
 */
export declare function selectDecisionForStep(response: ApprovalDecisionResponseV1, stepIndex: number): ApprovalDecisionEntry | null;
/**
 * P3 Phase 2: select the entry for EXACTLY one gate emission cycle. A parked
 * advisory gate polls for the cycle-N entry only — the prior cycle-0 entry
 * (already decided when the advisory episode began) must never satisfy it.
 */
export declare function selectDecisionForStepAndCycle(response: ApprovalDecisionResponseV1, stepIndex: number, gateCycle: number): ApprovalDecisionEntry | null;
/**
 * Map a polled status to Core's directive. Pure and total over the status enum.
 */
export declare function interpretDecisionStatus(status: ApprovalDecisionStatus): DecisionDirective;
/**
 * Interpret a single gate entry (or its absence) into Core's directive. A null
 * entry (the gate is not in the polled list yet) is `wait` - never approval
 * (fail-closed, INV-LA-AUTH3).
 */
export declare function interpretDecision(entry: ApprovalDecisionEntry | null): DecisionDirective;
//# sourceMappingURL=decision.d.ts.map