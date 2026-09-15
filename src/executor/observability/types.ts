/**
 * Execution observability projection types (read models only).
 * @see docs/product/executor-execution-observability-explainability-contract-v1.md
 */

import type { WorkerChainStage, WorkerResultOutcome } from "../worker/types.js";

export type ExecutionTraceProjection = {
  readonly trace_id: string;
  readonly job_id: string;
  readonly worker_result_idempotency_key: string;
  readonly terminal_outcome: WorkerResultOutcome;
  readonly authority_record_id?: string;
  readonly invocation_record_id?: string;
  readonly handler_result_id?: string;
  readonly command_record_id?: string;
  readonly mutation_record_id?: string;
  readonly lineage_ref: readonly string[];
  readonly recorded_at: string;
  readonly source_record_refs: readonly string[];
};

export type ExecutionTimelineStageKind =
  | "worker_terminal"
  | "authority_consumed"
  | "handler_invoked"
  | "command_executed"
  | "mutation_applied"
  | "halted";

export type ExecutionTimelineEntry = {
  readonly at: string;
  readonly kind: ExecutionTimelineStageKind;
  readonly record_ref: string;
  readonly decision?: string;
  readonly note?: string;
};

export type ExecutionTimelineProjection = {
  readonly timeline_id: string;
  readonly job_id: string;
  readonly entries: readonly ExecutionTimelineEntry[];
  readonly terminal_stage: WorkerChainStage;
  readonly recorded_at: string;
};

export type ExecutionExplainabilityRecord = {
  readonly explain_id: string;
  readonly job_id: string;
  readonly summary: string;
  readonly mutation_decision_explain?: string;
  readonly authority_consumed_ref?: string;
  readonly chain_stage_summary: readonly string[];
  readonly terminal_stage: WorkerChainStage;
  readonly halt_cause?: string;
  readonly replay_lineage_ref: readonly string[];
  readonly recorded_at: string;
  readonly descriptive_replay?: boolean;
};

export type ObservabilityRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class ObservabilityRejectedError extends Error implements ObservabilityRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ObservabilityRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}

export type ExecutionSummaryStatus =
  | "completed"
  | "denied"
  | "halted"
  | "unavailable";

export type ExecutionSummaryProjection = {
  readonly execution_id: string;
  readonly job_id: string;
  readonly title: string;
  readonly status: ExecutionSummaryStatus;
  readonly owner: string;
  readonly duration_ms?: number;
  readonly duration_display?: string;
  readonly authority_reference?: string;
  readonly rejection_cause?: string;
  readonly replay_available: boolean;
  readonly created_at: string;
  readonly timeline_id: string;
};

export type RecentExecutionsProjection = {
  readonly list_id: string;
  readonly generated_at: string;
  readonly items: readonly ExecutionSummaryProjection[];
  readonly limit: number;
  readonly truncated: boolean;
};

export const DEFAULT_RECENT_EXECUTIONS_LIMIT = 50;
export const MAX_RECENT_EXECUTIONS_LIMIT = 100;

export type BuildObservabilityInput = {
  readonly worker_result: import("../worker/types.js").WorkerResultRecord;
  readonly now?: Date;
  readonly descriptive_replay?: boolean;
};

export type BuildExecutionSummaryInput = {
  readonly worker_result: import("../worker/types.js").WorkerResultRecord;
  readonly stored_at: string;
  readonly now?: Date;
};

export type StoredWorkerEvidence = {
  readonly worker_result: import("../worker/types.js").WorkerResultRecord;
  readonly stored_at: string;
};

export type BuildRecentExecutionsInput = {
  readonly bundles: readonly StoredWorkerEvidence[];
  readonly limit: number;
  readonly now?: Date;
};

export type DecisionHistoryStage =
  | "authority_granted"
  | "handler_invoked"
  | "command_authorized"
  | "mutation_applied"
  | "halted";

export type DecisionHistoryEntry = {
  readonly stage: DecisionHistoryStage;
  readonly decision: string;
  readonly actor_id: string;
  readonly authority_reference?: string;
  readonly reason?: string;
  readonly timestamp: string;
  readonly lineage_reference: string;
  readonly replay_reference?: string;
};

export type DecisionHistoryProjection = {
  readonly history_id: string;
  readonly job_id: string;
  readonly execution_id: string;
  readonly request_label: string;
  readonly entries: readonly DecisionHistoryEntry[];
  readonly recorded_at: string;
};

export type HealthSignalType =
  | "stalled_chain_detected"
  | "retry_spike_detected"
  | "pending_duration_exceeded"
  | "failure_rate_elevated"
  | "queue_pressure_detected";

export type HealthSignalSeverity = "low" | "medium" | "high";

export type WorkflowHealthSignal = {
  readonly health_signal_id: string;
  readonly signal_type: HealthSignalType;
  readonly severity: HealthSignalSeverity;
  readonly affected_execution_count: number;
  readonly threshold_reference: string;
  readonly observed_value: string;
  readonly observed_at: string;
  readonly lineage_reference: string;
  readonly explainability_reference?: string;
};

export type WorkflowHealthRecord = {
  readonly record_id: string;
  readonly evaluated_at: string;
  readonly evidence_window_start: string;
  readonly evidence_window_end: string;
  readonly rule_version: string;
  readonly signals: readonly WorkflowHealthSignal[];
};

export type WorkflowHealthProjection = {
  readonly projection_id: string;
  readonly generated_at: string;
  readonly signals: readonly WorkflowHealthSignal[];
  readonly unavailable?: boolean;
  readonly unavailable_reason?: string;
};

export type BuildWorkflowHealthProjectionInput = {
  readonly bundles: readonly StoredWorkerEvidence[];
  readonly window_hours?: number;
  readonly now?: Date;
};

export type InspectabilityStatus = "available" | "partial" | "unavailable";

export type ReplayInspectionProjection = {
  readonly replay_reference: string;
  readonly execution_id: string;
  readonly trace_reference: string;
  readonly decision_history_reference: string;
  readonly timeline_reference: string;
  readonly inspect_bundle_reference: string;
  readonly lineage_hash: string;
  readonly created_at: string;
  readonly inspectability_status: InspectabilityStatus;
};

export type ReplayInspectSurface =
  | "execution_lineage"
  | "trace_references"
  | "decision_chain"
  | "timeline_references"
  | "projection_bundle_export"
  | "deterministic_replay_metadata";

export type ReplayInspectionPayload = {
  readonly trace: ExecutionTraceProjection;
  readonly timeline?: ExecutionTimelineProjection;
  readonly explain?: ExecutionExplainabilityRecord;
  readonly decision_history: DecisionHistoryProjection;
  readonly execution_lineage_refs: readonly string[];
};

export type ReplayInspectionBundle = {
  readonly bundle_id: string;
  readonly generated_at: string;
  readonly projection: ReplayInspectionProjection;
  readonly surfaces: readonly ReplayInspectSurface[];
  readonly payload: ReplayInspectionPayload;
  readonly unavailable_reason?: string;
};

export type BuildReplayInspectionBundleInput = {
  readonly worker_result: import("../worker/types.js").WorkerResultRecord;
  readonly now?: Date;
};

export type TimelineTrustStatus = "available" | "partial" | "unavailable";

export type TimelineTrustEventKind =
  | "state_transition"
  | "decision_point"
  | "refusal_point"
  | "stage_marker"
  | "health_snapshot_ref"
  | "lineage_anchor";

export type TimelineTrustEvent = {
  readonly event_id: string;
  readonly at: string;
  readonly kind: TimelineTrustEventKind;
  readonly label: string;
  readonly record_ref: string;
  readonly lineage_ref?: string;
  readonly decision?: string;
  readonly refusal_reason?: string;
  readonly prior_state?: string;
  readonly next_state?: string;
  readonly health_snapshot_ref?: string;
  readonly note?: string;
};

export type TimelineTrustSurface =
  | "ordered_execution_stages"
  | "stage_timing"
  | "authority_checkpoints"
  | "mutation_checkpoints"
  | "halt_boundaries"
  | "projection_lineage_references";

export type TimelineTrustSurfaceProjection = {
  readonly trust_timeline_id: string;
  readonly execution_id: string;
  readonly trace_reference: string;
  readonly timeline_reference: string;
  readonly decision_history_reference: string;
  readonly event_count: number;
  readonly trust_status: TimelineTrustStatus;
  readonly created_at: string;
};

export type TimelineTrustSurfaceView = {
  readonly view_id: string;
  readonly generated_at: string;
  readonly projection: TimelineTrustSurfaceProjection;
  readonly surfaces: readonly TimelineTrustSurface[];
  readonly events: readonly TimelineTrustEvent[];
  readonly timeline: ExecutionTimelineProjection;
  readonly unavailable_reason?: string;
};

export type BuildTimelineTrustSurfaceInput = {
  readonly worker_result: import("../worker/types.js").WorkerResultRecord;
  readonly now?: Date;
};

export type CorrelationTrustStatus = "available" | "partial" | "unavailable";

export type CorrelatedTrustSurface =
  | "timeline_health_correlation"
  | "halt_mutation_correlation"
  | "retry_queue_pressure_correlation"
  | "decision_failure_correlation"
  | "lineage_linked_evidence";

export type CorrelationTrustKind =
  | "timeline_health"
  | "halt_mutation"
  | "retry_queue_pressure"
  | "decision_failure"
  | "lineage_evidence";

export type CorrelationTrustLink = {
  readonly correlation_link_id: string;
  readonly kind: CorrelationTrustKind;
  readonly label: string;
  readonly left_ref: string;
  readonly right_ref: string;
  readonly observed_at: string;
  readonly rule_reference: string;
  readonly note?: string;
};

export type CorrelatedExecutionTrustProjection = {
  readonly correlation_id: string;
  readonly execution_id: string;
  readonly timeline_trust_reference: string;
  readonly health_projection_reference: string;
  readonly decision_history_reference: string;
  readonly correlation_count: number;
  readonly correlation_status: CorrelationTrustStatus;
  readonly created_at: string;
};

export type CorrelatedTrustSurfaceView = {
  readonly view_id: string;
  readonly generated_at: string;
  readonly projection: CorrelatedExecutionTrustProjection;
  readonly surfaces: readonly CorrelatedTrustSurface[];
  readonly links: readonly CorrelationTrustLink[];
  readonly unavailable_reason?: string;
};

export type BuildCorrelatedTrustSurfaceInput = {
  readonly worker_result: import("../worker/types.js").WorkerResultRecord;
  readonly evidence_bundles?: readonly StoredWorkerEvidence[];
  readonly window_hours?: number;
  readonly now?: Date;
};

export type DiagnosticsStatus = "available" | "partial" | "unavailable";

export type ExecutionDiagnosticsSurface =
  | "repeated_halt_clustering"
  | "retry_concentration_windows"
  | "queue_pressure_hotspots"
  | "mutation_instability_zones"
  | "decision_refusal_density"
  | "diagnostic_lineage_references";

export type DiagnosticFindingKind =
  | "halt_cluster"
  | "retry_window"
  | "queue_hotspot"
  | "mutation_instability"
  | "refusal_density"
  | "lineage_diagnostic";

export type DiagnosticFinding = {
  readonly finding_id: string;
  readonly kind: DiagnosticFindingKind;
  readonly label: string;
  readonly surface: ExecutionDiagnosticsSurface;
  readonly evidence_ref: string;
  readonly projection_ref: string;
  readonly observed_at: string;
  readonly rule_reference: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly count?: number;
  readonly note?: string;
};

export type ExecutionDiagnosticsProjection = {
  readonly diagnostics_id: string;
  readonly evidence_window_start: string;
  readonly evidence_window_end: string;
  readonly correlation_reference?: string;
  readonly timeline_trust_reference?: string;
  readonly health_projection_reference: string;
  readonly finding_count: number;
  readonly diagnostics_status: DiagnosticsStatus;
  readonly anchor_job_id?: string;
  readonly created_at: string;
};

export type ExecutionDiagnosticsBundle = {
  readonly bundle_id: string;
  readonly generated_at: string;
  readonly projection: ExecutionDiagnosticsProjection;
  readonly surfaces: readonly ExecutionDiagnosticsSurface[];
  readonly findings: readonly DiagnosticFinding[];
  readonly unavailable_reason?: string;
};

export type GovernanceTrustStatus = "available" | "partial" | "unavailable";

export type ExecutionGovernanceSurface =
  | "invariant_pressure_zones"
  | "boundary_proximity_indicators"
  | "replay_authority_separation_checks"
  | "cross_surface_doctrine_consistency"
  | "governance_drift_references"
  | "governance_lineage_references";

export type GovernanceIndicatorKind =
  | "invariant_pressure"
  | "boundary_proximity"
  | "replay_authority_separation"
  | "doctrine_consistency"
  | "governance_drift"
  | "governance_lineage";

export type GovernanceIndicator = {
  readonly indicator_id: string;
  readonly kind: GovernanceIndicatorKind;
  readonly label: string;
  readonly surface: ExecutionGovernanceSurface;
  readonly policy_reference: string;
  readonly evidence_ref: string;
  readonly projection_ref: string;
  readonly observed_at: string;
  readonly rule_reference: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly count?: number;
  readonly note?: string;
};

export type ExecutionGovernanceProjection = {
  readonly governance_id: string;
  readonly evidence_window_start: string;
  readonly evidence_window_end: string;
  readonly diagnostics_reference: string;
  readonly correlation_reference?: string;
  readonly replay_inspection_reference?: string;
  readonly indicator_count: number;
  readonly governance_status: GovernanceTrustStatus;
  readonly anchor_job_id?: string;
  readonly created_at: string;
};

export type GovernanceTrustBundle = {
  readonly bundle_id: string;
  readonly generated_at: string;
  readonly projection: ExecutionGovernanceProjection;
  readonly surfaces: readonly ExecutionGovernanceSurface[];
  readonly indicators: readonly GovernanceIndicator[];
  readonly unavailable_reason?: string;
};

export type BuildGovernanceTrustBundleInput = {
  readonly bundles: readonly StoredWorkerEvidence[];
  readonly anchor_evidence?: StoredWorkerEvidence;
  readonly window_hours?: number;
  readonly now?: Date;
};
