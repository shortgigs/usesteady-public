/**
 * P1 Authority Assertion V1 — pending-approval gate decision basis (Core twin).
 *
 * Recomputes the exact basis the Portal signed from Core's own live gate input,
 * so a signed decision is bound to the gate content Core actually has open.
 * Must stay byte-identical to the Portal normalization in usesteady-ops
 * `lib/portal/authorityAssertion/gateBasis.ts` (golden vectors pin this).
 */
import type { PendingApprovalInput, PendingApprovalSystemWill } from "../pending-approval/payload.js";
/** Normalize to the explicit five-field shape (nulls materialized, summary trimmed). */
export declare function normalizeGateBasisSystemWill(sw: PendingApprovalSystemWill): {
    summary: string;
    action_type: string;
    affected_resources: unknown;
    affected_resources_total: unknown;
    affected_resources_truncated: boolean;
};
/** sha256 hex of canonical({ risk, system_will }) over the normalized shape. */
export declare function pendingGateDecisionBasisFromPayload(input: {
    readonly risk: string;
    readonly system_will: PendingApprovalSystemWill;
}): string;
/**
 * Recompute the signed basis for the gate Core currently has open. Uses the
 * same builder as the emit path so the recomputation matches what the Portal
 * stored (and signed) byte-for-byte after normalization.
 */
export declare function pendingGateDecisionBasisFromInput(input: PendingApprovalInput): string;
//# sourceMappingURL=gate-basis.d.ts.map