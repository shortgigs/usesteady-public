/**
 * P6 V1 — split executor self-report from independent outcome verification.
 *
 * Executor `accepted` is a delivery/execution report. It is never, by itself,
 * a verified-against-reality verdict. Only an independent observer
 * (`makeFsRealityProbe` on supported FS ops) may produce `agree`.
 *
 * Vocabulary is existing: RealityVerdict + pulse status. Do not invent names.
 */
import type { FsChange } from "../understand/interpretation/types.js";
import type { ExecutableOperation, ExecutionPayload, RealityVerdict } from "../governed-decision/types.js";
import type { RealityProbe } from "../governed-decision/stages/observation.js";
export type ExecutorReportKind = "accepted" | "failed";
/** Pulse / Portal status. Existing W2 literals. */
export type OutcomeVerificationStatus = "verified" | "disagreement" | "unknown" | "unverified";
export type OutcomeObservationKind = RealityVerdict | "not_observed";
export type OutcomeVerification = {
    readonly executorReport: ExecutorReportKind;
    readonly status: OutcomeVerificationStatus;
    /** Raw independent observation. Distinct from `status` (reconciliation). */
    readonly observation: OutcomeObservationKind;
    /**
     * Verdict the trust-surface pulse may count. Omitted when the observation
     * must not become verified-against-reality (no observer, or executor failed).
     */
    readonly realityVerdict?: RealityVerdict;
    readonly intendedVsActual?: "match" | "deviation" | "unknown";
    readonly observationDetail?: string;
    readonly executorReportId?: string;
    readonly observationId?: string;
    readonly reconciliationId?: string;
};
export type ReconcileOutcomeInput = {
    readonly executorReport: ExecutorReportKind;
    readonly observerAvailable: boolean;
    readonly probeVerdict?: RealityVerdict;
    readonly probeError?: boolean;
    readonly probeDetail?: string;
};
/**
 * Reconcile X (executor report) with O (independent observation) into R.
 * Never rewrites X. Never promotes accepted alone. Never promotes failed+match
 * to a pulse `agree`.
 */
export declare function reconcileOutcome(input: ReconcileOutcomeInput): OutcomeVerification;
export declare function fsChangeTargetPath(op: FsChange): string;
/**
 * Map a workflow FS op onto the existing probe's ExecutableOperation.
 * Unsupported / opaque kinds return null — observer not available (honest).
 */
export declare function fsChangeToExecutableOp(op: FsChange): ExecutableOperation | null;
export declare function executionPayloadForApprovedOp(op: ExecutableOperation, claimedRan: boolean): ExecutionPayload;
export declare function runIndependentProbe(probe: RealityProbe, payload: ExecutionPayload): {
    verdict: RealityVerdict;
    detail?: string;
    error: boolean;
};
/** R applies to X and O only when the bound ids still match. */
export declare function reconciliationBinds(input: {
    readonly reconciliationExecutorReportId: string;
    readonly reconciliationObservationId: string;
    readonly executorReportId: string;
    readonly observationId: string;
}): boolean;
//# sourceMappingURL=outcome-verification.d.ts.map