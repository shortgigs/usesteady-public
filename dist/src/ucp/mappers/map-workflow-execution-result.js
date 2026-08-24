import { createExecutionResultEnvelope } from "../envelope.js";
/**
 * Map a workflow terminal execution-result projection to ucp.execution_result.v1.
 *
 * Shadow-only in this phase: this envelope is dual-written for observability and
 * parity checks while CLI result ownership remains unchanged.
 */
export function mapWorkflowExecutionResultToEnvelope(result, refs) {
    return createExecutionResultEnvelope({
        succeeded: result.succeeded,
        errorCode: result.errorCode,
        ...(typeof result.stdout === "string" ? { stdout: result.stdout } : {}),
        ...(typeof result.stderr === "string" ? { stderr: result.stderr } : {}),
        ...(typeof result.exitCode === "number" ? { exitCode: result.exitCode } : {}),
    }, refs);
}
//# sourceMappingURL=map-workflow-execution-result.js.map