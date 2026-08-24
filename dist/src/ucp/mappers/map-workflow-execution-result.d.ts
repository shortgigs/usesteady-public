import type { ExecutionResultEnvelope, UCPRefs } from "../types.js";
export type WorkflowExecutionResultLike = {
    readonly succeeded: boolean;
    readonly errorCode: string | null;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exitCode?: number;
};
/**
 * Map a workflow terminal execution-result projection to ucp.execution_result.v1.
 *
 * Shadow-only in this phase: this envelope is dual-written for observability and
 * parity checks while CLI result ownership remains unchanged.
 */
export declare function mapWorkflowExecutionResultToEnvelope(result: WorkflowExecutionResultLike, refs?: UCPRefs): ExecutionResultEnvelope;
//# sourceMappingURL=map-workflow-execution-result.d.ts.map