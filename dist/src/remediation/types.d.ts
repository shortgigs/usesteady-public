/**
 * Remediation proposal generator types (candidates only — no execution).
 * @see docs/product/remediation-proposal-generator-contract-v1.md
 * @see docs/product/remediation-proposal-generator-implementation-contract-v1.md
 */
import type { DiagnosticClass } from "../diagnostics/types.js";
export type ExecutionCapabilityId = "CAP-001" | "CAP-002" | "CAP-003";
export type ProposalCapabilityBinding = {
    readonly observation_code: string;
    readonly capability_id: ExecutionCapabilityId;
    readonly registry_version: string;
};
export type ExecutionCapability = {
    readonly capability_id: ExecutionCapabilityId;
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly action_class: DiagnosticClass;
};
export type RemediationProposal = {
    readonly proposal_id: string;
    readonly diagnostic_id: string;
    readonly diagnostic_code: string;
    readonly capability_id: ExecutionCapabilityId;
    readonly reason: string;
    readonly expected_effect: string;
    readonly rollback_guidance: string;
    readonly proposal_version: string;
    readonly created_from: "diagnostic_record";
    readonly action_class: DiagnosticClass;
    readonly title: string;
    readonly severity: "low" | "medium" | "high";
    readonly priority: 1 | 2 | 3;
};
export type RemediationProposalRecord = {
    readonly record_id: string;
    readonly generated_at: string;
    readonly diagnostic_id: string;
    readonly overall: "none" | "proposed" | "blocked_ambiguous";
    readonly proposals: readonly RemediationProposal[];
};
//# sourceMappingURL=types.d.ts.map