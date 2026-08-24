/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - Core-side public surface.
 * Step 1: frozen wire types + pure payload builder/validator.
 * Step 2a: run -> input mapping (read-only) + pure on-machine redaction.
 * Step 2b: opt-in resolution (default off), best-effort HTTPS POST, and the
 *          guarded report orchestrator wired at run completion.
 */
export { EXECUTION_RETURN_SCHEMA, AFFECTED_RESOURCES_LIMIT, } from "./types.js";
export { buildExecutionReturnPayload, validateExecutionReturnPayload, } from "./build-payload.js";
export { redactAffectedResources, } from "./redact.js";
export { summarizeDecisions, stepsToAffectedResources, mapRunToExecutionReturnInput, } from "./map-run.js";
export { resolvePortalReporting, normalizePortalRunsBaseUrl, PORTAL_RUNS_URL_ENV, PORTAL_TOKEN_ENV, } from "./opt-in.js";
export { sendExecutionReturn, } from "./transport.js";
export { reportRunToPortal, decisionSummaryFromOutcomes, unavailableDecisionSummary, decisionSummaryFromExplicitRatification, deliveryReportSummaryFromOutcomes, outcomeVerificationFromTasks, } from "./report-run.js";
export { resolveReportUcpRootId, primaryTaskInput, } from "./resolve-report-ucp-root.js";
//# sourceMappingURL=index.js.map