/**
 * Resolve the ucp_root_id for --report-to-portal payloads.
 *
 * Portal reports must carry a Core-valid intent root (64-char content hash),
 * never workflowRunId (16-char run identifier).
 *
 * Feature 2.3: the selected root is materialized, strictly persisted when
 * absent, and exactly read back before any certification chain snapshot.
 */
import { type ChainVerification } from "../../ucp/chain-verification.js";
import type { WorkflowRun } from "../../workflow/types.js";
export declare class CertificationReportSnapshotError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export type CertificationChainSnapshot = {
    readonly ucpRootId: string;
    readonly entryIds: readonly string[];
    readonly chainCount: number;
    readonly chainVerification: ChainVerification;
};
declare function primaryTaskInput(run: WorkflowRun): string;
/**
 * Existing root-selection identity, plus strict persist + exact read-back.
 * Throws on identity mismatch, persist failure, or read-back mismatch.
 */
export declare function resolveReportUcpRootId(run: WorkflowRun, storeDir: string): string;
/**
 * One immutable ordered-ID snapshot. Call only after root acknowledgement.
 */
export declare function captureCertificationChainSnapshot(storeDir: string, ucpRootId: string): CertificationChainSnapshot;
/**
 * Root acknowledgement, then one snapshot. getChain cannot run first.
 */
export declare function prepareCertificationReportSnapshot(run: WorkflowRun, storeDir: string): CertificationChainSnapshot;
export { primaryTaskInput };
//# sourceMappingURL=resolve-report-ucp-root.d.ts.map