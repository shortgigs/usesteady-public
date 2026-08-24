/**
 * P6 V1 — observe and persist X → O → R after a workflow FS delivery.
 * Append-only. Does not mutate the executor report.
 */
import type { RealityProbe } from "../governed-decision/stages/observation.js";
import type { FsChange } from "../understand/interpretation/types.js";
import { type ExecutorReportKind, type OutcomeVerification } from "./outcome-verification.js";
export type OutcomeVerificationContext = {
    readonly workspaceRoot?: string;
    readonly realityProbe?: RealityProbe;
    readonly storeDir: string;
    readonly workflowRunId: string;
    readonly stepIndex: number;
};
export declare function observeAndPersistFsOutcome(input: {
    readonly op: FsChange;
    readonly executorReport: ExecutorReportKind;
    readonly executorDetail?: string;
    readonly errorCode?: string;
    readonly context: OutcomeVerificationContext;
}): OutcomeVerification;
export declare function unverifiedFromAccepted(): OutcomeVerification;
//# sourceMappingURL=persist-outcome-verification.d.ts.map