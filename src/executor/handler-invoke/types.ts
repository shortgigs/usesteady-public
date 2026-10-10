/**
 * Real handler invocation types — records only (no command execution).
 * @see docs/product/executor-real-handler-invoke-contract-v1.md
 */

import type { AuthorizationScope, ExecutionAuthorityRecord } from "../authority/types.js";
import type { BackgroundJobRecord } from "../jobs/types.js";

export type HandlerInvocationDecision = "invoked" | "denied";

export type HandlerInvocationRecord = {
  readonly invocation_record_id: string;
  readonly invocation_idempotency_key: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly request_id: string;
  readonly execution_id: string;
  readonly handler_intent_id: string;
  readonly capability_id: string;
  readonly decision: HandlerInvocationDecision;
  readonly invoked_at: string;
  readonly authorization_scope: AuthorizationScope;
  readonly denial_cause?: string;
  readonly lineage_ref: readonly string[];
};

export type HandlerExecutionOutcome = "completed" | "failed" | "blocked";

export type HandlerExecutionResultRecord = {
  readonly result_record_id: string;
  readonly invocation_record_id: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly outcome: HandlerExecutionOutcome;
  readonly result_summary: string;
  readonly error_cause?: string;
  readonly recorded_at: string;
  readonly lineage_ref: readonly string[];
};

export type InvokeRealHandlerInput = {
  readonly job: BackgroundJobRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly prior_invocations?: readonly HandlerInvocationRecord[];
  readonly prior_results?: readonly HandlerExecutionResultRecord[];
  readonly invocation_idempotency_key: string;
  readonly now: Date;
};

export type InvokeRealHandlerOutput = {
  readonly invocation: HandlerInvocationRecord;
  readonly result: HandlerExecutionResultRecord;
};

export type HandlerInvokeRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class HandlerInvokeRejectedError extends Error implements HandlerInvokeRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "HandlerInvokeRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
