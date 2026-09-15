/**
 * Executor runtime types (record-only — no handler execution).
 * @see docs/product/executor-runtime-implementation-contract-v1.md
 */

import type { ExecutorEligibilityRecord } from "../eligibility/types.js";

export type ExecutionOutcome = "completed" | "failed" | "aborted";

export type ExecutionLineageKind =
  | "gate_passed"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "execution_aborted";

export type ExecutionLineageEntry = {
  readonly at: string;
  readonly kind: ExecutionLineageKind;
  readonly note?: string;
};

export type ExecutionRecord = {
  readonly execution_id: string;
  readonly executor_eligibility_record_id: string;
  readonly capability_id: string;
  readonly capability_eligibility_record_id: string;
  readonly executed_at: string;
  readonly executed_by: "operator";
  readonly outcome: ExecutionOutcome;
  readonly reason: string;
  readonly blocking_cause: string;
  readonly lineage: readonly ExecutionLineageEntry[];
};

export type ExecuteProposalInput = {
  readonly executor_eligibility: ExecutorEligibilityRecord;
  readonly operator_confirmation: true;
  readonly now?: Date;
  readonly executed_at?: string;
  readonly outcome?: ExecutionOutcome;
};

export type ExecutorRuntimeRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class ExecutorRuntimeRejectedError extends Error implements ExecutorRuntimeRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ExecutorRuntimeRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
