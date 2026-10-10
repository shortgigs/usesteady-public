/**
 * Browser-safe mirror of Apply Fix preview types (read-only DTOs).
 * @see docs/product/executor-react-apply-fix-ui-contract-v1.md
 */

export type ApplyFixAuthorityKind = "presentation_only";

export type ApplyFixAuthorityNotice = {
  readonly kind: ApplyFixAuthorityKind;
  readonly message: string;
};

export type ApplyFixLineageRow = {
  readonly at: string;
  readonly source: "job" | "ledger" | "handler_intent";
  readonly kind: string;
  readonly execution_id: string;
  readonly ledger_entry_id: string;
  readonly handler_intent_id: string;
  readonly note?: string;
};

/** Terminal success body from POST /api/executor/apply-fix-preview only. */
export type ApplyFixViewModel = {
  readonly view_id: string;
  readonly authority: ApplyFixAuthorityNotice;
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly job_kind: "replay_notify" | "retry_transport";
  readonly transport_state: "enqueued";
  readonly execution_id: string;
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly ledger_entry_id: string;
  readonly store_sequence: number;
  readonly intent_summary: string;
  readonly target_scope: readonly string[];
  readonly risk_notes: readonly string[];
  readonly actor_id: string;
  readonly recorded_at: string;
  readonly enqueued_at: string;
  readonly payload_hash: string;
  readonly lineage_rows: readonly ApplyFixLineageRow[];
  readonly operator_path_note: string;
};

export type ExecutorEligibilityState = "allowed" | "blocked" | "expired";

export type ExecutorEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated" | "revalidated" | "expired" | "blocked";
  readonly executor_eligibility_state: ExecutorEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ExecutorEligibilityRecord = {
  readonly capability_id: string;
  readonly capability_eligibility_record_id: string;
  readonly executor_eligibility_state: ExecutorEligibilityState;
  readonly executor_eligibility_checked_at: string;
  readonly executor_eligibility_ttl_ms: number;
  readonly executor_eligibility_expires_at: string;
  readonly executor_eligibility_record_id: string;
  readonly lineage: readonly ExecutorEligibilityLineageEntry[];
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ExecutionLedgerActor = {
  readonly kind: "operator";
  readonly actor_id: string;
};

/** Request body for the sole allowed preview API call. */
export type ApplyFixPreviewRequest = {
  readonly eligibility: ExecutorEligibilityRecord;
  readonly operator_confirmation: true;
  readonly capability_handler_id: string;
  readonly ledger_actor: ExecutionLedgerActor;
  readonly store_dir: string;
  readonly job_kind: ApplyFixViewModel["job_kind"];
  readonly executed_at: string;
};

export type ExecutorRouteErrorEnvelope = {
  readonly error: true;
  readonly rejection_cause: string;
  readonly explain: string;
};

export const PREVIEW_AUTHORITY_BANNER =
  "Preview only — no action executed";

export const MUTATION_REQUEST_AUTHORITY_BANNER =
  "Mutation request only — no execution or authority mint from this surface";

/** Presentation-only mutation intent (INV-UIMUT-1). */
export type MutationIntentRequest = {
  readonly intent_idempotency_key: string;
  readonly job_id: string;
  readonly capability_id: string;
  readonly target_scope: readonly string[];
  readonly mutation_summary: string;
  readonly lineage_ref: readonly string[];
  readonly requested_at: string;
  readonly presentation_surface: "react_apply_fix";
};

export type MutationAllowedEnvelope = {
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly target_scope: readonly string[];
  readonly job_kind: ApplyFixViewModel["job_kind"];
};

export type MutationIntentRequestBody = {
  readonly intent: MutationIntentRequest;
  readonly allowed_envelope: MutationAllowedEnvelope;
};

export type MutationIntentSuccessBody = {
  readonly ok: true;
  readonly intent_idempotency_key: string;
  readonly validated_intent: MutationIntentRequest;
  readonly idempotent_replay?: boolean;
};

/** Operator-bound pre-mint bundle (INV-UIMUT-2). */
export type MutationAuthorizationRequest = {
  readonly authorization_request_id: string;
  readonly intent_idempotency_key: string;
  readonly validated_intent: MutationIntentRequest;
  readonly actor_id: string;
  readonly operator_confirmation: true;
  readonly confirmation_at: string;
  readonly scope_envelope: MutationAllowedEnvelope;
  readonly lineage_ref: readonly string[];
};

export type MutationAuthorizationRequestBody = {
  readonly authorization_request: MutationAuthorizationRequest;
};

export type MutationAuthorizationSuccessBody = {
  readonly ok: true;
  readonly accepted: true;
  readonly authorization_request_id: string;
  readonly intent_idempotency_key: string;
  readonly note: string;
  readonly idempotent_replay?: boolean;
};

export type WorkerResultOutcome =
  | "transport_completed"
  | "transport_failed"
  | "dead_letter"
  | "awaiting_execution_authority"
  | "idempotent_skip"
  | "execution_chain_completed"
  | "execution_chain_halted";

export type WorkerChainStatusPhase =
  | "awaiting_authority"
  | "awaiting_job"
  | "worker_pending"
  | "chain_halted"
  | "chain_completed";

export type WorkerChainStatusProjection = {
  readonly projection_id: string;
  readonly job_id: string;
  readonly intent_idempotency_key: string;
  readonly phase: WorkerChainStatusPhase;
  readonly terminal_outcome?: WorkerResultOutcome;
  readonly halt_cause?: string;
  readonly authority_record_id?: string;
  readonly recorded_at: string;
  readonly descriptive_replay?: boolean;
};

export type UiChainIntakeRecord = {
  readonly intake_id: string;
  readonly authorization_request_id: string;
  readonly intent_idempotency_key: string;
  readonly status: "accepted" | "denied";
  readonly recorded_at: string;
  readonly lineage_ref: readonly string[];
};

export type UiChainIntakeRequestBody = {
  readonly authorization_request: MutationAuthorizationRequest;
  readonly operator_mint_confirmation: true;
  readonly pipeline: ApplyFixPreviewRequest;
};

export type UiChainIntakeSuccessBody = {
  readonly ok: true;
  readonly intake: UiChainIntakeRecord;
  readonly job_id: string;
  readonly projection: WorkerChainStatusProjection;
  readonly idempotent_replay?: boolean;
};

export type WorkerChainStatusSuccessBody = {
  readonly ok: true;
  readonly projection: WorkerChainStatusProjection;
  readonly idempotent_replay?: boolean;
};

export const WORKER_CHAIN_STATUS_BANNER =
  "Worker chain status is descriptive only — no execution from this surface";

export type ExecutionTimelineStageKind =
  | "worker_terminal"
  | "authority_consumed"
  | "handler_invoked"
  | "command_executed"
  | "mutation_applied"
  | "halted";

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
  readonly terminal_stage: string;
  readonly recorded_at: string;
};

export type ExecutionExplainabilityRecord = {
  readonly explain_id: string;
  readonly job_id: string;
  readonly summary: string;
  readonly mutation_decision_explain?: string;
  readonly authority_consumed_ref?: string;
  readonly chain_stage_summary: readonly string[];
  readonly terminal_stage: string;
  readonly halt_cause?: string;
  readonly replay_lineage_ref: readonly string[];
  readonly recorded_at: string;
  readonly descriptive_replay?: boolean;
};

export type ObservabilityTraceSuccessBody = {
  readonly ok: true;
  readonly trace: ExecutionTraceProjection;
};

export type ObservabilityTimelineSuccessBody = {
  readonly ok: true;
  readonly timeline: ExecutionTimelineProjection;
};

export type ObservabilityExplainSuccessBody = {
  readonly ok: true;
  readonly explain: ExecutionExplainabilityRecord;
};

export const EXECUTION_OBSERVABILITY_BANNER =
  "Execution observability is descriptive only — explainability is not execution";

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

export type ObservabilityRecentSuccessBody = {
  readonly ok: true;
  readonly recent: RecentExecutionsProjection;
};

export const RECENT_EXECUTIONS_BANNER =
  "Recent executions are an observation surface, not a control surface";

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

export type ObservabilityHistorySuccessBody = {
  readonly ok: true;
  readonly history: DecisionHistoryProjection;
};

export const DECISION_HISTORY_BANNER =
  "Decision history explains execution; it does not influence execution";

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

export type WorkflowHealthProjection = {
  readonly projection_id: string;
  readonly generated_at: string;
  readonly signals: readonly WorkflowHealthSignal[];
  readonly unavailable?: boolean;
  readonly unavailable_reason?: string;
};

export type ObservabilityHealthSuccessBody = {
  readonly ok: true;
  readonly health: WorkflowHealthProjection;
};

export const WORKFLOW_HEALTH_BANNER =
  "Health describes system state; it never prescribes system action";

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

export type ObservabilityInspectSuccessBody = {
  readonly ok: true;
  readonly inspect: ReplayInspectionBundle;
};

export const REPLAY_INSPECTION_BANNER =
  "Replay inspection reconstructs lineage; it never re-executes lineage";

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

export type ObservabilityTimelineTrustSuccessBody = {
  readonly ok: true;
  readonly timeline_trust: TimelineTrustSurfaceView;
};

export const TIMELINE_TRUST_SURFACE_BANNER =
  "Execution timeline is descriptive only — it does not re-execute lineage";

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

export type ObservabilityCorrelatedTrustSuccessBody = {
  readonly ok: true;
  readonly correlation_trust: CorrelatedTrustSurfaceView;
};

export const CORRELATED_TRUST_SURFACE_BANNER =
  "Correlation explains relationships between execution signals; it never directs execution behavior";

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

export type ObservabilityExecutionDiagnosticsSuccessBody = {
  readonly ok: true;
  readonly diagnostics: ExecutionDiagnosticsBundle;
};

export const EXECUTION_DIAGNOSTICS_SURFACE_BANNER =
  "Diagnostics describe recurring execution conditions; they never modify execution conditions";

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

export type ObservabilityExecutionGovernanceSuccessBody = {
  readonly ok: true;
  readonly governance: GovernanceTrustBundle;
};

export const EXECUTION_GOVERNANCE_SURFACE_BANNER =
  "Governance surfaces describe execution trust boundaries; they never enforce execution trust boundaries";

export type ReplaySandboxState = "candidate" | "blocked" | "expired";

export type ReplaySandboxReconstructedInputs = {
  readonly executor_eligibility_record_id: string;
  readonly capability_id: string;
  readonly capability_eligibility_record_id: string;
  readonly executed_at: string;
  readonly executed_by: "operator";
  readonly outcome: "completed" | "failed" | "aborted";
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ReplaySandboxCandidate = {
  readonly replay_sandbox_id: string;
  readonly execution_id: string;
  readonly reconstructed_capability_id: string;
  readonly reconstructed_inputs: ReplaySandboxReconstructedInputs;
  readonly replay_state: ReplaySandboxState;
  readonly replay_lineage: readonly string[];
  readonly replay_generated_at: string;
  readonly replay_version: string;
};

export type ReplaySandboxStatus = "available" | "partial" | "unavailable";
export type ReplayIsolationStatus = "isolated" | "partial" | "unavailable";

export type ReplayExecutionSandboxSurface =
  | "replay_candidate_summary"
  | "determinism_checks"
  | "drift_comparison"
  | "replay_safety_boundary_checks"
  | "replay_audit_lineage"
  | "replay_isolation_status";

export type ReplaySandboxCheck = {
  readonly check_id: string;
  readonly kind: string;
  readonly label: string;
  readonly surface: ReplayExecutionSandboxSurface;
  readonly evidence_ref: string;
  readonly projection_ref: string;
  readonly policy_reference: string;
  readonly observed_at: string;
  readonly rule_reference: string;
  readonly pass: boolean;
  readonly note?: string;
};

export type ReplaySandboxEnvelope = {
  readonly envelope_id: string;
  readonly candidate_id: string;
  readonly isolation_token: string;
  readonly sandbox_workspace_ref: string;
  readonly envelope_status: ReplayIsolationStatus;
  readonly non_authoritative: true;
  readonly created_at: string;
};

export type ReplaySandboxProjection = {
  readonly sandbox_id: string;
  readonly source_job_id: string;
  readonly inspect_bundle_reference: string;
  readonly candidate_reference: string;
  readonly envelope_reference: string;
  readonly check_count: number;
  readonly audit_count: number;
  readonly sandbox_status: ReplaySandboxStatus;
  readonly isolation_status: ReplayIsolationStatus;
  readonly created_at: string;
};

export type ReplaySandboxBundle = {
  readonly bundle_id: string;
  readonly generated_at: string;
  readonly projection: ReplaySandboxProjection;
  readonly candidate: ReplaySandboxCandidate;
  readonly envelope: ReplaySandboxEnvelope;
  readonly surfaces: readonly ReplayExecutionSandboxSurface[];
  readonly checks: readonly ReplaySandboxCheck[];
  readonly audit_records: readonly { readonly audit_id: string; readonly event_kind: string; readonly note?: string }[];
  readonly unavailable_reason?: string;
};

export type ObservabilityReplaySandboxSuccessBody = {
  readonly ok: true;
  readonly replay_sandbox: ReplaySandboxBundle;
};

export type ReplayExecutionState = "executed" | "blocked" | "expired";

export type ReplayExecutionLineageEntry = {
  readonly at: string;
  readonly kind: string;
  readonly note?: string;
};

export type ReplayExecutionRecord = {
  readonly replay_execution_id: string;
  readonly replay_sandbox_id: string;
  readonly replay_execution_state: ReplayExecutionState;
  readonly replay_execution_created_at: string;
  readonly replay_execution_version: string;
  readonly replay_execution_lineage: readonly ReplayExecutionLineageEntry[];
  readonly replay_execution_reason: string;
};

export type ReplayExecutionSuccessBody = {
  readonly ok: true;
  readonly replay_execution: ReplayExecutionRecord;
};

export type ReplayExecutionAuditEntry = {
  readonly audit_entry_id: string;
  readonly job_id: string;
  readonly operator_id: string;
  readonly replay_sandbox_id: string;
  readonly replay_execution_id: string;
  readonly replay_execution_state: ReplayExecutionState;
  readonly recorded_at: string;
  readonly replay_execution_version: string;
  readonly replay_execution_reason: string;
  readonly source_record_ref: string;
};

export type ObservabilityReplayExecutionHistorySuccessBody = {
  readonly ok: true;
  readonly entries: readonly ReplayExecutionAuditEntry[];
};

export const REPLAY_EXECUTION_HISTORY_BANNER =
  "Replay execution history is a record-only audit trail. No production side effects occurred.";

export const REPLAY_SANDBOX_BANNER =
  "Replay Sandbox is an isolated simulation candidate. No production execution occurred.";

export const REPLAY_SANDBOX_AUTHORITY_DISCLAIMER =
  "Replay execution candidates are isolated simulations; they never inherit production execution authority.";
