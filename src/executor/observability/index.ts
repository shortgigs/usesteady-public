/**
 * Execution observability — read-only projections from WorkerResultRecord.
 */

export type {
  ExecutionTraceProjection,
  ExecutionTimelineProjection,
  ExecutionTimelineEntry,
  ExecutionTimelineStageKind,
  ExecutionExplainabilityRecord,
  ExecutionSummaryProjection,
  ExecutionSummaryStatus,
  RecentExecutionsProjection,
  DecisionHistoryProjection,
  DecisionHistoryEntry,
  DecisionHistoryStage,
  WorkflowHealthProjection,
  WorkflowHealthRecord,
  WorkflowHealthSignal,
  HealthSignalType,
  HealthSignalSeverity,
  BuildWorkflowHealthProjectionInput,
  BuildReplayInspectionBundleInput,
  ReplayInspectionProjection,
  ReplayInspectionBundle,
  ReplayInspectionPayload,
  ReplayInspectSurface,
  InspectabilityStatus,
  TimelineTrustStatus,
  TimelineTrustEvent,
  TimelineTrustEventKind,
  TimelineTrustSurface,
  TimelineTrustSurfaceProjection,
  TimelineTrustSurfaceView,
  BuildTimelineTrustSurfaceInput,
  CorrelationTrustStatus,
  CorrelationTrustKind,
  CorrelationTrustLink,
  CorrelatedTrustSurface,
  CorrelatedExecutionTrustProjection,
  CorrelatedTrustSurfaceView,
  BuildCorrelatedTrustSurfaceInput,
  DiagnosticsStatus,
  DiagnosticFindingKind,
  DiagnosticFinding,
  ExecutionDiagnosticsSurface,
  ExecutionDiagnosticsProjection,
  ExecutionDiagnosticsBundle,
  GovernanceTrustStatus,
  GovernanceIndicatorKind,
  GovernanceIndicator,
  ExecutionGovernanceSurface,
  ExecutionGovernanceProjection,
  GovernanceTrustBundle,
  BuildGovernanceTrustBundleInput,
  BuildObservabilityInput,
  BuildExecutionSummaryInput,
  BuildRecentExecutionsInput,
  StoredWorkerEvidence,
  ObservabilityRejection,
} from "./types.js";

export {
  ObservabilityRejectedError,
  DEFAULT_RECENT_EXECUTIONS_LIMIT,
  MAX_RECENT_EXECUTIONS_LIMIT,
} from "./types.js";
export { buildTraceProjection } from "./build-trace-projection.js";
export { buildTimelineProjection } from "./build-timeline-projection.js";
export { buildExplainabilityRecord } from "./build-explainability-record.js";
export { buildExecutionSummaryProjection } from "./build-execution-summary-projection.js";
export { buildRecentExecutionsProjection } from "./build-recent-executions-projection.js";
export { buildDecisionHistoryProjection } from "./build-decision-history-projection.js";
export {
  buildWorkflowHealthProjection,
  WorkflowHealthProjectionBuilder,
} from "./build-workflow-health-projection.js";
export { buildWorkflowHealthRecord } from "./build-workflow-health-record.js";
export {
  WORKFLOW_HEALTH_RULE_VERSION,
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
} from "./workflow-health-thresholds.js";
export { buildReplayInspectionProjection } from "./build-replay-inspection-projection.js";
export { buildReplayInspectionBundle } from "./build-replay-inspection-bundle.js";
export {
  buildTimelineTrustEvents,
  buildTimelineTrustSurfaceProjection,
  deriveTimelineTrustStatus,
} from "./build-timeline-trust-surface-projection.js";
export { buildTimelineTrustSurfaceView } from "./build-timeline-trust-surface-view.js";
export {
  buildCorrelationLinks,
  buildCorrelatedExecutionTrustProjection,
  deriveCorrelationTrustStatus,
  sortCorrelationLinks,
} from "./build-correlated-trust-projection.js";
export { buildCorrelatedTrustSurfaceView } from "./build-correlated-trust-view.js";
export {
  buildDiagnosticFindings,
  buildExecutionDiagnosticsProjection,
  deriveDiagnosticsStatus,
  filterBundlesInWindow,
  sortDiagnosticFindings,
  resolveDiagnosticsWindow,
} from "./build-execution-diagnostics-projection.js";
export { buildExecutionDiagnosticsBundle } from "./build-execution-diagnostics-bundle.js";
export { EXECUTION_DIAGNOSTICS_RULE_VERSION } from "./execution-diagnostics-thresholds.js";
export {
  buildGovernanceIndicators,
  buildExecutionGovernanceProjection,
  deriveGovernanceStatus,
  sortGovernanceIndicators,
} from "./build-execution-governance-projection.js";
export { buildGovernanceTrustBundle } from "./build-governance-trust-bundle.js";
export { EXECUTION_GOVERNANCE_RULE_VERSION } from "./execution-governance-thresholds.js";

import type { BuildObservabilityInput } from "./types.js";
import { buildTraceProjection } from "./build-trace-projection.js";
import { buildTimelineProjection } from "./build-timeline-projection.js";
import { buildExplainabilityRecord } from "./build-explainability-record.js";

export function buildObservabilityBundle(input: BuildObservabilityInput) {
  const trace = buildTraceProjection(input);
  const timeline = buildTimelineProjection({
    trace,
    worker_result: input.worker_result,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  const explain = buildExplainabilityRecord({
    trace,
    timeline,
    worker_result:      input.worker_result,
    ...(input.now !== undefined ? { now: input.now } : {}),
    ...(input.descriptive_replay !== undefined ? { descriptive_replay: input.descriptive_replay } : {}),
  });
  return { trace, timeline, explain };
}
