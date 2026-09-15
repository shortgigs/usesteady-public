/**
 * Replay sandbox DTOs — isolated simulation metadata only (no execution authority).
 * @see docs/product/executor-replay-execution-sandbox-contract-v1.md
 */

import type { ExecutionRecord } from "../executor/runtime/types.js";

export type ReplaySandboxState = "candidate" | "blocked" | "expired";

export type ReplaySandboxJob = {
  readonly execution: ExecutionRecord;
};

export type ReplaySandboxReconstructedInputs = {
  readonly executor_eligibility_record_id: string;
  readonly capability_id: string;
  readonly capability_eligibility_record_id: string;
  readonly executed_at: string;
  readonly executed_by: "operator";
  readonly outcome: ExecutionRecord["outcome"];
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

export type ReplaySandboxCheckKind =
  | "determinism"
  | "drift"
  | "safety_boundary"
  | "isolation";

export type ReplaySandboxCheck = {
  readonly check_id: string;
  readonly kind: ReplaySandboxCheckKind;
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

export type ReplayAuditEventKind =
  | "candidate_staged"
  | "determinism_checked"
  | "drift_compared"
  | "boundary_checked"
  | "isolation_verified";

export type ReplayAuditRecord = {
  readonly audit_id: string;
  readonly candidate_id: string;
  readonly envelope_id: string;
  readonly event_kind: ReplayAuditEventKind;
  readonly evidence_ref: string;
  readonly projection_ref: string;
  readonly policy_reference: string;
  readonly observed_at: string;
  readonly rule_reference: string;
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
  readonly audit_records: readonly ReplayAuditRecord[];
  readonly unavailable_reason?: string;
};

export class ReplaySandboxRejectedError extends Error {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ReplaySandboxRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
