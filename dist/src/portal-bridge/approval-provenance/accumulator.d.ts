/**
 * Phase 3 Lane A (A2) — accumulate bridge decisions and resolve execution-return
 * approval_record fields per frozen mapping (PHASE3_APPROVAL_PROVENANCE_SOURCE_AUDIT_V1).
 */
import type { ApprovalDecisionEntry } from "../pending-approval/decision.js";
import type { RemoteAuthorityEvidence } from "../pending-approval/resolve-remote.js";
import type { BridgeApprovalProvenanceState, ExecutionReturnApprovalProvenance } from "./types.js";
export declare function createBridgeApprovalProvenanceState(): BridgeApprovalProvenanceState;
/**
 * Record an approved bridge decision. Only `approved` entries with non-empty
 * `decided_by` are stored; later approvals overwrite (last wins for multi-step).
 * The P1 authority evidence rides alongside; absence of evidence is recorded as
 * `self_asserted`, never silently upgraded.
 */
export declare function recordBridgeApprovalDecision(state: BridgeApprovalProvenanceState, entry: ApprovalDecisionEntry, authority?: RemoteAuthorityEvidence): BridgeApprovalProvenanceState;
/**
 * Web POST /confirm (S2): fold a remote Portal decision into per-run provenance.
 *
 * Only a remote `yes` with an approved entry updates state (same rule as CLI).
 * Reject / null / missing prior state leave provenance unchanged (or empty).
 * Pure transport-sidecar — no authority.
 */
export declare function accumulateBridgeApprovalFromRemote(state: BridgeApprovalProvenanceState | undefined, remote: {
    readonly decision: "yes" | "no";
    readonly entry: ApprovalDecisionEntry;
    readonly authority?: RemoteAuthorityEvidence;
} | null): BridgeApprovalProvenanceState;
/**
 * Apply Mode A / Mode B precedence for execution-return `approval_record`:
 *   Mode A — any bridge `decided_by` collected → approver + decided_at from bridge
 *   Mode B — else → approver null, approved_at from max UCP handoff confirmedAt
 * Mode B is always `self_asserted` (UCP handoff timestamps are transport
 * metadata, not authenticated human provenance).
 */
export declare function resolveExecutionReturnApprovalProvenance(bridgeState: BridgeApprovalProvenanceState, storeDir: string, workflowRunId: string): ExecutionReturnApprovalProvenance;
//# sourceMappingURL=accumulator.d.ts.map