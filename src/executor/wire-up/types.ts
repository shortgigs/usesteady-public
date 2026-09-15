/**
 * Executor pipeline orchestration types (sequential call only — no authority).
 * @see docs/product/executor-server-wire-up-contract-v1.md
 */

import type { ExecutorEligibilityRecord } from "../eligibility/types.js";
import type { BackgroundJobKind } from "../jobs/types.js";
import type { ExecutionLedgerActor } from "../ledger/types.js";
import type { ApplyFixViewModel } from "../ui/types.js";

export type RunExecutorPipelineInput = {
  readonly eligibility: ExecutorEligibilityRecord;
  readonly operator_confirmation: boolean;
  readonly capability_handler_id: string;
  readonly ledger_actor: ExecutionLedgerActor;
  readonly store_dir: string;
  readonly job_kind: BackgroundJobKind;
  readonly executed_at: string;
  readonly now: Date;
};

export type WireUpPipelineRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class WireUpPipelineRejectedError extends Error implements WireUpPipelineRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "WireUpPipelineRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}

export type { ApplyFixViewModel };
