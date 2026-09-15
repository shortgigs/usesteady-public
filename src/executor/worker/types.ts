/**
 * Queue worker transport + auto-wiring types.
 * @see docs/product/executor-queue-worker-contract-v1.md
 * @see docs/product/executor-worker-auto-wiring-contract-v1.md
 */

import type { CommandExecutionRequest } from "../command/types.js";
import type { ExecutionAuthorityRecord } from "../authority/types.js";
import type {
  HandlerExecutionResultRecord,
  HandlerInvocationRecord,
} from "../handler-invoke/types.js";
import type { BackgroundJobLineageEntry, BackgroundJobRecord } from "../jobs/types.js";
import type { CommandExecutionRecord } from "../command/types.js";
import type { ScopedMutationStore, StateMutationRecord, StateMutationRequest } from "../mutation/types.js";

export type WorkerClaimState =
  | "claimed"
  | "completed"
  | "failed"
  | "dead_letter"
  | "awaiting_execution_authority";

export type WorkerJobClaim = {
  readonly claim_id: string;
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly claimed_at: string;
  readonly claim_state: WorkerClaimState;
};

export type WorkerResultOutcome =
  | "transport_completed"
  | "transport_failed"
  | "dead_letter"
  | "awaiting_execution_authority"
  | "idempotent_skip"
  | "execution_chain_completed"
  | "execution_chain_halted";

export type WorkerChainStage =
  | "authority_consumed"
  | "handler_invoked"
  | "command_executed"
  | "mutation_applied"
  | "halted";

export type WorkerExecutionChainLineage = {
  readonly chain_idempotency_key: string;
  readonly authority_record_id: string;
  readonly terminal_stage: WorkerChainStage;
  readonly halt_cause?: string;
  readonly invocation?: HandlerInvocationRecord;
  readonly handler_result?: HandlerExecutionResultRecord;
  readonly command?: CommandExecutionRecord;
  readonly mutation?: StateMutationRecord;
};

export type WorkerResultRecord = {
  readonly job_id: string;
  readonly idempotency_key: string;
  readonly processed_at: string;
  readonly outcome: WorkerResultOutcome;
  readonly note: string;
  readonly lineage_ref: readonly BackgroundJobLineageEntry[];
  readonly execution_chain?: WorkerExecutionChainLineage;
};

export type WorkerAutoWireRequest = {
  readonly chain_idempotency_key: string;
  readonly invocation_idempotency_key: string;
  readonly command_request: CommandExecutionRequest;
  readonly mutation_request: StateMutationRequest;
  readonly scoped_store?: ScopedMutationStore;
  readonly prior_invocations?: readonly HandlerInvocationRecord[];
  readonly prior_handler_results?: readonly HandlerExecutionResultRecord[];
  readonly prior_commands?: readonly CommandExecutionRecord[];
  readonly prior_mutations?: readonly StateMutationRecord[];
};

export type WorkerStatusRecord = {
  readonly job_id: string;
  readonly at: string;
  readonly status: WorkerClaimState;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly rejection_cause?: string;
  readonly explain?: string;
};

export type WorkerJobValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejection_cause: string; readonly explain: string };

export type ProcessBackgroundJobInput = {
  readonly job: BackgroundJobRecord;
  readonly now: Date;
  /** 1-based attempt counter for bounded retry (INV-QWORK-4). */
  readonly attempt: number;
  /** Append-only authority decisions — consumed, never authored by worker (INV-QWORK-0). */
  readonly authority_records: readonly ExecutionAuthorityRecord[];
  /** Prior worker results for idempotent replay (INV-QWORK-3). */
  readonly prior_results?: readonly WorkerResultRecord[];
  /**
   * Optional certified chain orchestration (INV-WAUTO-*).
   * Requires granted, unexpired authority — worker never mints authority.
   */
  readonly auto_wire?: WorkerAutoWireRequest;
};

export type RunWorkerAutoWireInput = {
  readonly job: BackgroundJobRecord;
  readonly authority: ExecutionAuthorityRecord;
  readonly request: WorkerAutoWireRequest;
  readonly now: Date;
  readonly prior_chain_results?: readonly WorkerResultRecord[];
};

export type RunWorkerAutoWireOutput = {
  readonly result: WorkerResultRecord;
  readonly scoped_store?: ScopedMutationStore;
};

export type ProcessBackgroundJobOutput = {
  readonly claim: WorkerJobClaim;
  readonly status: WorkerStatusRecord;
  readonly result: WorkerResultRecord;
};
