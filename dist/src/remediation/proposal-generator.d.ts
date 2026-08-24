/**
 * Pure remediation proposal generator (candidates only).
 */
import type { DiagnosticRecord } from "../diagnostics/types.js";
import type { ExecutionCapability, ExecutionCapabilityId, RemediationProposalRecord } from "./types.js";
export { PROPOSAL_VERSION } from "./proposal-copy.js";
export { PROPOSAL_CAPABILITY_BINDINGS_V1 } from "./proposal-bindings.js";
export { EXECUTION_CAPABILITY_CATALOG_V1 } from "./catalog-v1.js";
/** Stable proposal identity — no timestamp (INV-GEN-5). */
export declare function stableProposalId(input: {
    readonly diagnostic_id: string;
    readonly diagnostic_code: string;
    readonly capability_id: ExecutionCapabilityId;
    readonly proposal_version: string;
}): string;
/**
 * Pure generator — diagnostics only, no I/O (INV-GEN-IMPL-1).
 */
export declare function generateRemediationProposalsFromDiagnostic(diagnostic: DiagnosticRecord, catalog?: readonly ExecutionCapability[]): RemediationProposalRecord;
//# sourceMappingURL=proposal-generator.d.ts.map