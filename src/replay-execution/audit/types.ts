/**
 * PREX execution history & audit types (append-only, descriptive).
 * @see docs/product/prex-execution-history-audit-contract-v1.md
 */

import type { ReplayExecutionState } from "../types.js";

export type ReplayExecutionAuditState = ReplayExecutionState;

export type ReplayExecutionAuditEntry = {
  readonly audit_entry_id: string;
  readonly job_id: string;
  readonly operator_id: string;
  readonly replay_sandbox_id: string;
  readonly replay_execution_id: string;
  readonly replay_execution_state: ReplayExecutionAuditState;
  readonly recorded_at: string;
  readonly replay_execution_version: string;
  readonly replay_execution_reason: string;
  readonly source_record_ref: string;
};

export type AppendReplayExecutionAuditResult = {
  readonly entry: ReplayExecutionAuditEntry;
  readonly idempotent: boolean;
};

export class ReplayExecutionAuditRejectedError extends Error {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ReplayExecutionAuditRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
