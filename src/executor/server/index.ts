/**
 * Executor HTTP route surface (transport only).
 * @see docs/product/executor-server-route-contract-v1.md
 */

export type {
  ExecutorApplyFixRequestBody,
  ExecutorRouteErrorEnvelope,
  ExecutorRouteFailure,
  ExecutorRouteRejection,
  ExecutorRouteResult,
  ExecutorRouteSuccess,
} from "./types.js";

export { ExecutorRouteRejectedError } from "./types.js";
export { validateExecutorApplyFixRequest } from "./validate-request.js";
export {
  handleExecutorApplyFixPreview,
  registerExecutorApplyFixRoute,
  ROUTE_PATH,
  runExecutorApplyFixPreview,
} from "./route-handler.js";

export {
  registerExecutorMutationWiringRoutes,
  MUTATION_INTENT_ROUTE,
  MUTATION_AUTHORIZATION_REQUEST_ROUTE,
  isIntentValidated,
  isAuthorizationAccepted,
  seedMutationWiringReplayForTests,
} from "./mutation-wiring-route.js";

export {
  registerExecutorWorkerChainIntegrationRoutes,
  UI_CHAIN_INTAKE_ROUTE,
  UI_CHAIN_STATUS_ROUTE_PREFIX,
  resetWorkerChainIntegrationStoresForTests,
  seedWorkerChainProjectionForTests,
} from "./worker-chain-integration-route.js";

export type {
  UiChainIntakeRecord,
  WorkerChainStatusProjection,
  WorkerChainStatusPhase,
  UiChainIntakeSuccessBody,
  WorkerChainStatusSuccessBody,
} from "./worker-chain-types.js";

export { validateUiChainIntakeBody } from "./validate-worker-chain-request.js";
export { orchestrateUiChainIntake } from "./orchestrate-ui-chain-intake.js";

export {
  registerExecutorObservabilityRoutes,
  OBSERVABILITY_TRACE_ROUTE_PREFIX,
  OBSERVABILITY_TIMELINE_ROUTE_PREFIX,
  OBSERVABILITY_EXPLAIN_ROUTE_PREFIX,
} from "./observability-route.js";

export {
  registerExecutorRecentExecutionsRoute,
  OBSERVABILITY_RECENT_ROUTE,
} from "./recent-executions-route.js";

export {
  registerExecutorDecisionHistoryRoute,
  OBSERVABILITY_HISTORY_ROUTE_PREFIX,
} from "./decision-history-route.js";

export {
  registerExecutorWorkflowHealthRoute,
  OBSERVABILITY_HEALTH_ROUTE,
} from "./workflow-health-route.js";

export {
  registerExecutorReplayInspectionRoute,
  OBSERVABILITY_INSPECT_ROUTE_PREFIX,
} from "./replay-inspection-route.js";

export {
  registerExecutorTimelineTrustSurfaceRoute,
  OBSERVABILITY_TIMELINE_TRUST_ROUTE,
} from "./timeline-trust-surface-route.js";

export {
  registerExecutorCorrelatedTrustRoute,
  OBSERVABILITY_CORRELATED_TRUST_ROUTE,
} from "./correlated-trust-route.js";

export {
  registerExecutorExecutionDiagnosticsRoute,
  OBSERVABILITY_EXECUTION_DIAGNOSTICS_ROUTE,
} from "./execution-diagnostics-route.js";

export {
  registerExecutorExecutionGovernanceRoute,
  OBSERVABILITY_EXECUTION_GOVERNANCE_ROUTE,
} from "./execution-governance-route.js";

export {
  registerExecutorReplaySandboxRoute,
  OBSERVABILITY_REPLAY_SANDBOX_ROUTE_PREFIX,
} from "./replay-sandbox-route.js";

export {
  registerExecutorReplayExecutionRoute,
  EXECUTOR_REPLAY_EXECUTION_ROUTE_PREFIX,
} from "./replay-execution-route.js";

export {
  registerExecutorReplayExecutionHistoryRoute,
  OBSERVABILITY_REPLAY_EXECUTION_HISTORY_ROUTE_PREFIX,
} from "./replay-execution-history-route.js";

export {
  registerExecutorReplayWorkerRoute,
  EXECUTOR_REPLAY_WORKER_ROUTE_PREFIX,
} from "./replay-worker-route.js";

export {
  registerExecutorReplayWorkerExecutionRoute,
  EXECUTOR_REPLAY_WORKER_EXECUTION_ROUTE_PREFIX,
} from "./replay-worker-execution-route.js";

export {
  registerExecutorReplayWorkerSideEffectRoute,
  EXECUTOR_REPLAY_WORKER_SIDE_EFFECT_ROUTE_PREFIX,
} from "./replay-worker-side-effect-route.js";

export {
  registerExecutorReplayWorkerMutationRoute,
  EXECUTOR_REPLAY_WORKER_MUTATION_ROUTE_PREFIX,
} from "./replay-worker-mutation-route.js";

export {
  registerExecutorReplayWorkerIoAuditRoute,
  EXECUTOR_REPLAY_WORKER_IO_AUDIT_ROUTE_PREFIX,
} from "./replay-worker-io-audit-route.js";

export {
  registerExecutorReplayWorkerIoMetadataRoute,
  EXECUTOR_REPLAY_WORKER_IO_METADATA_ROUTE_PREFIX,
} from "./replay-worker-io-metadata-route.js";

export {
  registerExecutorReplayWorkerIoTraceRoute,
  EXECUTOR_REPLAY_WORKER_IO_TRACE_ROUTE_PREFIX,
} from "./replay-worker-io-trace-route.js";

export {
  appendReplayExecutionAuditEntry,
  deriveReplayExecutionAuditEntry,
  listReplayExecutionAuditEntries,
  resetReplayExecutionAuditStoreForTests,
} from "../../replay-execution/audit/index.js";

export {
  storeExecutionEvidence,
  getExecutionEvidence,
  resetExecutionEvidenceStoreForTests,
  seedExecutionEvidenceForTests,
} from "./execution-evidence-store.js";

export {
  buildTraceProjection,
  buildTimelineProjection,
  buildExplainabilityRecord,
  buildExecutionSummaryProjection,
  buildRecentExecutionsProjection,
  buildDecisionHistoryProjection,
  buildWorkflowHealthProjection,
  WorkflowHealthProjectionBuilder,
  buildReplayInspectionBundle,
  buildReplayInspectionProjection,
  buildTimelineTrustSurfaceView,
  buildCorrelatedTrustSurfaceView,
  buildExecutionDiagnosticsBundle,
  buildGovernanceTrustBundle,
  buildObservabilityBundle,
  ObservabilityRejectedError,
} from "../observability/index.js";

export type {
  ExecutionTraceProjection,
  ExecutionTimelineProjection,
  ExecutionExplainabilityRecord,
  ExecutionSummaryProjection,
  RecentExecutionsProjection,
  DecisionHistoryProjection,
  WorkflowHealthProjection,
  WorkflowHealthRecord,
  ReplayInspectionBundle,
  ReplayInspectionProjection,
  TimelineTrustSurfaceView,
  TimelineTrustSurfaceProjection,
  CorrelatedTrustSurfaceView,
  CorrelatedExecutionTrustProjection,
  ExecutionDiagnosticsBundle,
  ExecutionDiagnosticsProjection,
} from "../observability/types.js";

export { listExecutionEvidenceBundles } from "./execution-evidence-store.js";
