/**
 * Real command execution types — records only (no state mutation).
 * @see docs/product/real-command-execution-contract-v1.md
 */

import type { ExecutionAuthorityRecord } from "../authority/types.js";
import type {
  HandlerExecutionResultRecord,
  HandlerInvocationRecord,
} from "../handler-invoke/types.js";

export type CommandExecutionScope = {
  readonly capability_id: string;
  readonly handler_intent_id: string;
  readonly command_class: string;
  readonly target_scope: readonly string[];
};

export type CommandAuthorizationKind = "operator_gate" | "worker_self";

export type CommandExecutionRequest = {
  readonly request_id: string;
  readonly command_idempotency_key: string;
  readonly handler_result_id: string;
  readonly invocation_record_id: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly actor_id: string;
  readonly reason: string;
  readonly authorization_kind: CommandAuthorizationKind;
  readonly command_scope: CommandExecutionScope;
  readonly prepared_at: string;
  readonly expires_at: string;
  readonly ttl_ms: number;
};

export type CommandExecutionDecision = "authorized" | "denied";

export type CommandExecutionRecord = {
  readonly command_record_id: string;
  readonly command_idempotency_key: string;
  readonly request_id: string;
  readonly handler_result_id: string;
  readonly invocation_record_id: string;
  readonly authority_record_id: string;
  readonly job_id: string;
  readonly decision: CommandExecutionDecision;
  readonly actor_id: string;
  readonly command_scope: CommandExecutionScope;
  readonly reason: string;
  readonly decided_at: string;
  readonly expires_at: string;
  readonly denial_cause?: string;
  readonly lineage_ref: readonly string[];
};

export type ExecuteCommandInput = {
  readonly handler_result: HandlerExecutionResultRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly invocation: HandlerInvocationRecord;
  readonly request: CommandExecutionRequest;
  readonly prior_executions?: readonly CommandExecutionRecord[];
  readonly now: Date;
};

export type CommandExecutionRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class CommandExecutionRejectedError extends Error implements CommandExecutionRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "CommandExecutionRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
