/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - Core-side public surface.
 * Step 1: frozen wire types + pure payload builder/validator.
 * Step 2a: run -> input mapping (read-only) + pure on-machine redaction.
 * Step 2b: opt-in resolution (default off), best-effort HTTPS POST, and the
 *          guarded report orchestrator wired at run completion.
 */
export {
  EXECUTION_RETURN_SCHEMA,
  AFFECTED_RESOURCES_LIMIT,
  type ExecutionOutcome,
  type ApprovalMode,
  type ResourceChangeType,
  type ExecutionReturnDecisionSummary,
  type ExecutionReturnDeliveryReportSummary,
  type DecisionCountAvailabilityBasis,
  type ExecutedCountBasis,
  type ExecutionReturnApprovalRecord,
  type ExecutionReturnAffectedResource,
  type ExecutionReturnResumeTokenMeta,
  type ExecutionReturnChainRef,
  type ExecutionReturnPayloadV1,
} from "./types.js";

export {
  buildExecutionReturnPayload,
  validateExecutionReturnPayload,
  type ExecutionReturnInput,
  type PayloadValidation,
} from "./build-payload.js";

export {
  redactAffectedResources,
  type RedactionPolicy,
  type RedactionResult,
} from "./redact.js";

export {
  summarizeDecisions,
  stepsToAffectedResources,
  mapRunToExecutionReturnInput,
  type DecisionStep,
  type RunReturnMetadata,
} from "./map-run.js";

export {
  resolvePortalReporting,
  normalizePortalRunsBaseUrl,
  PORTAL_RUNS_URL_ENV,
  PORTAL_TOKEN_ENV,
  type PortalReportingConfig,
  type PortalReportingDisabledReason,
} from "./opt-in.js";

export {
  sendExecutionReturn,
  type SendResult,
  type SendOptions,
} from "./transport.js";

export {
  reportRunToPortal,
  decisionSummaryFromOutcomes,
  unavailableDecisionSummary,
  decisionSummaryFromExplicitRatification,
  deliveryReportSummaryFromOutcomes,
  outcomeVerificationFromTasks,
  type ReportOutcome,
} from "./report-run.js";

export {
  resolveReportUcpRootId,
  primaryTaskInput,
} from "./resolve-report-ucp-root.js";
