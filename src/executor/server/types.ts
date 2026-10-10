/**
 * HTTP transport types for executor apply-fix preview route (no authority).
 * @see docs/product/executor-server-route-contract-v1.md
 */

import type { RunExecutorPipelineInput } from "../wire-up/types.js";
import type { ApplyFixViewModel } from "../ui/types.js";

/** JSON body accepted by POST /api/executor/apply-fix-preview (after validation). */
export type ExecutorApplyFixRequestBody = {
  readonly eligibility: RunExecutorPipelineInput["eligibility"];
  readonly operator_confirmation: true;
  readonly capability_handler_id: string;
  readonly ledger_actor: RunExecutorPipelineInput["ledger_actor"];
  readonly store_dir: string;
  readonly job_kind: RunExecutorPipelineInput["job_kind"];
  readonly executed_at: string;
};

export type ExecutorRouteErrorEnvelope = {
  readonly error: true;
  readonly rejection_cause: string;
  readonly explain: string;
};

export type ExecutorRouteSuccess = {
  readonly ok: true;
  readonly status: 200;
  readonly view: ApplyFixViewModel;
};

export type ExecutorRouteFailure = {
  readonly ok: false;
  readonly status: number;
  readonly body: ExecutorRouteErrorEnvelope;
};

export type ExecutorRouteResult = ExecutorRouteSuccess | ExecutorRouteFailure;

export type ExecutorRouteRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class ExecutorRouteRejectedError extends Error implements ExecutorRouteRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "ExecutorRouteRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
