/**
 * Worker execution chain orchestration — certified stage order only (INV-WAUTO-1..10).
 * Never mints authority — consumes operator-minted grants only.
 */

import { isExecutionAuthorityExpired } from "../authority/create-execution-authority-record.js";
import type { ExecutionAuthorityRecord } from "../authority/types.js";
import { executeCommand } from "../command/execute-command.js";
import type { CommandExecutionRecord } from "../command/types.js";
import { invokeRealHandler } from "../handler-invoke/invoke-real-handler.js";
import type {
  HandlerExecutionResultRecord,
  HandlerInvocationRecord,
} from "../handler-invoke/types.js";
import { applyStateMutation } from "../mutation/apply-state-mutation.js";
import type { StateMutationRecord } from "../mutation/types.js";
import { buildChainCompletedNote, buildChainHaltNote } from "./result-summary.js";
import type {
  RunWorkerAutoWireInput,
  RunWorkerAutoWireOutput,
  WorkerChainStage,
  WorkerExecutionChainLineage,
  WorkerResultOutcome,
  WorkerResultRecord,
} from "./types.js";
const CHAIN_TERMINAL_OUTCOMES = new Set<WorkerResultOutcome>([
  "execution_chain_completed",
  "execution_chain_halted",
]);

function isOperatorGateOnly(kind: string): boolean {
  return kind.trim() === "operator_gate";
}

function validateAuthorityForChain(input: {
  readonly job: RunWorkerAutoWireInput["job"];
  readonly authority: ExecutionAuthorityRecord;
  readonly now: Date;
}): { readonly ok: true } | { readonly ok: false; readonly halt_cause: string } {
  const { job, authority, now } = input;

  if (authority.job_id.trim() !== job.job_id.trim()) {
    return { ok: false, halt_cause: "authority_job_mismatch" };
  }
  if (authority.idempotency_key.trim() !== job.idempotency_key.trim()) {
    return { ok: false, halt_cause: "authority_idempotency_mismatch" };
  }
  if (authority.decision !== "granted") {
    return { ok: false, halt_cause: "authority_not_granted" };
  }
  if (isExecutionAuthorityExpired(authority, now)) {
    return { ok: false, halt_cause: "authority_expired" };
  }
  if (authority.authorization_scope.capability_id.trim() !== job.capability_id.trim()) {
    return { ok: false, halt_cause: "authority_scope_mismatch" };
  }
  return { ok: true };
}

function validateOperatorRequest<T extends { readonly authorization_kind: string }>(
  request: T,
  label: string,
): { readonly ok: true } | { readonly ok: false; readonly halt_cause: string } {
  if (!isOperatorGateOnly(request.authorization_kind)) {
    return { ok: false, halt_cause: `${label}_authorization_invalid` };
  }
  return { ok: true };
}

function findChainReplay(
  prior: readonly WorkerResultRecord[],
  chain_idempotency_key: string,
): WorkerResultRecord | undefined {
  const matches = prior.filter(
    (r) =>
      r.execution_chain?.chain_idempotency_key.trim() === chain_idempotency_key.trim() &&
      CHAIN_TERMINAL_OUTCOMES.has(r.outcome),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function buildChainResult(input: {
  readonly job: RunWorkerAutoWireInput["job"];
  readonly now: Date;
  readonly outcome: WorkerResultOutcome;
  readonly terminal_stage: WorkerChainStage;
  readonly chain_idempotency_key: string;
  readonly authority_record_id: string;
  readonly halt_cause?: string;
  readonly invocation?: HandlerInvocationRecord;
  readonly handler_result?: HandlerExecutionResultRecord;
  readonly commandRecord?: CommandExecutionRecord;
  readonly mutationRecord?: StateMutationRecord;
}): WorkerResultRecord {
  const processed_at = input.now.toISOString();
  const execution_chain: WorkerExecutionChainLineage = {
    chain_idempotency_key: input.chain_idempotency_key,
    authority_record_id:   input.authority_record_id,
    terminal_stage:        input.terminal_stage,
    ...(input.halt_cause !== undefined ? { halt_cause: input.halt_cause } : {}),
    ...(input.invocation !== undefined
      ? { invocation: structuredClone(input.invocation) }
      : {}),
    ...(input.handler_result !== undefined
      ? { handler_result: structuredClone(input.handler_result) }
      : {}),
    ...(input.commandRecord !== undefined
      ? { command: structuredClone(input.commandRecord) }
      : {}),
    ...(input.mutationRecord !== undefined
      ? { mutation: structuredClone(input.mutationRecord) }
      : {}),
  };

  const note =
    input.outcome === "execution_chain_completed"
      ? buildChainCompletedNote()
      : buildChainHaltNote({
          terminal_stage: input.terminal_stage,
          halt_cause:     input.halt_cause ?? "unspecified",
        });

  return {
    job_id:          input.job.job_id,
    idempotency_key: input.job.idempotency_key,
    processed_at,
    outcome:         input.outcome,
    note,
    lineage_ref:     structuredClone(input.job.lineage),
    execution_chain,
  };
}

function buildHaltedResult(input: {
  readonly job: RunWorkerAutoWireInput["job"];
  readonly now: Date;
  readonly chain_idempotency_key: string;
  readonly authority_record_id: string;
  readonly terminal_stage: WorkerChainStage;
  readonly halt_cause: string;
  readonly invocation?: HandlerInvocationRecord;
  readonly handler_result?: HandlerExecutionResultRecord;
  readonly commandRecord?: CommandExecutionRecord;
  readonly mutationRecord?: StateMutationRecord;
}): WorkerResultRecord {
  return buildChainResult({
    job:                   input.job,
    now:                   input.now,
    outcome:               "execution_chain_halted",
    terminal_stage:        input.terminal_stage,
    chain_idempotency_key: input.chain_idempotency_key,
    authority_record_id:   input.authority_record_id,
    halt_cause:            input.halt_cause,
    ...(input.invocation !== undefined ? { invocation: input.invocation } : {}),
    ...(input.handler_result !== undefined ? { handler_result: input.handler_result } : {}),
    ...(input.commandRecord !== undefined ? { commandRecord: input.commandRecord } : {}),
    ...(input.mutationRecord !== undefined ? { mutationRecord: input.mutationRecord } : {}),
  });
}

/**
 * Orchestrate invoke → command → mutation in mandatory order. Fail closed per stage.
 */
export function runWorkerAutoWire(input: RunWorkerAutoWireInput): RunWorkerAutoWireOutput {
  const prior = input.prior_chain_results ?? [];
  const replay = findChainReplay(prior, input.request.chain_idempotency_key);
  if (replay !== undefined) {
    return { result: replay };
  }

  const authorityCheck = validateAuthorityForChain({
    job:       input.job,
    authority: input.authority,
    now:       input.now,
  });

  if (!authorityCheck.ok) {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "halted",
        halt_cause:            authorityCheck.halt_cause,
      }),
    };
  }

  const commandReqCheck = validateOperatorRequest(
    input.request.command_request,
    "command",
  );
  if (!commandReqCheck.ok) {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "halted",
        halt_cause:            commandReqCheck.halt_cause,
      }),
    };
  }

  const mutationReqCheck = validateOperatorRequest(
    input.request.mutation_request,
    "mutation",
  );
  if (!mutationReqCheck.ok) {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "halted",
        halt_cause:            mutationReqCheck.halt_cause,
      }),
    };
  }

  const invokeOut = invokeRealHandler({
    job:                        input.job,
    authority:                  input.authority,
    invocation_idempotency_key: input.request.invocation_idempotency_key,
    ...(input.request.prior_invocations !== undefined ? { prior_invocations: input.request.prior_invocations } : {}),
    ...(input.request.prior_handler_results !== undefined ? { prior_results: input.request.prior_handler_results } : {}),
    now:                        input.now,
  });

  if (invokeOut.invocation.decision !== "invoked") {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "handler_invoked",
        halt_cause:            invokeOut.invocation.denial_cause ?? "invocation_denied",
        invocation:            invokeOut.invocation,
        handler_result:        invokeOut.result,
      }),
    };
  }

  if (invokeOut.result.outcome !== "completed") {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "handler_invoked",
        halt_cause:            "handler_not_completed",
        invocation:            invokeOut.invocation,
        handler_result:        invokeOut.result,
      }),
    };
  }

  const commandRecord = executeCommand({
    handler_result:   invokeOut.result,
    authority:        input.authority,
    invocation:       invokeOut.invocation,
    request:          input.request.command_request,
    ...(input.request.prior_commands !== undefined ? { prior_executions: input.request.prior_commands } : {}),
    now:              input.now,
  });

  if (commandRecord.decision !== "authorized") {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "command_executed",
        halt_cause:            commandRecord.denial_cause ?? "command_denied",
        invocation:            invokeOut.invocation,
        handler_result:        invokeOut.result,
        commandRecord,
      }),
    };
  }

  const mutationOut = applyStateMutation({
    command:          commandRecord,
    request:          input.request.mutation_request,
    ...(input.request.prior_mutations !== undefined ? { prior_mutations: input.request.prior_mutations } : {}),
    ...(input.request.scoped_store !== undefined ? { scoped_store: input.request.scoped_store } : {}),
    now:              input.now,
  });

  if (mutationOut.record.decision !== "applied") {
    return {
      result: buildHaltedResult({
        job:                   input.job,
        now:                   input.now,
        chain_idempotency_key: input.request.chain_idempotency_key,
        authority_record_id:   input.authority.authority_record_id,
        terminal_stage:        "mutation_applied",
        halt_cause:            mutationOut.record.denial_cause ?? "mutation_denied",
        invocation:            invokeOut.invocation,
        handler_result:        invokeOut.result,
        commandRecord,
        mutationRecord:        mutationOut.record,
      }),
    };
  }

  return {
    result: buildChainResult({
      job:                   input.job,
      now:                   input.now,
      outcome:               "execution_chain_completed",
      terminal_stage:        "mutation_applied",
      chain_idempotency_key: input.request.chain_idempotency_key,
      authority_record_id:   input.authority.authority_record_id,
      invocation:            invokeOut.invocation,
      handler_result:        invokeOut.result,
      commandRecord,
      mutationRecord:        mutationOut.record,
    }),
    ...(mutationOut.scoped_store !== undefined ? { scoped_store: mutationOut.scoped_store } : {}),
  };
}

/**
 * Descriptive replay of prior chain terminal WorkerResultRecord (INV-WAUTO-6).
 */
export function replayWorkerExecutionChain(input: {
  readonly prior_chain_results: readonly WorkerResultRecord[];
  readonly chain_idempotency_key: string;
}): WorkerResultRecord | undefined {
  return findChainReplay(input.prior_chain_results, input.chain_idempotency_key);
}
