/**
 * Worker execution chain note + lineage helpers (audit only).
 */

import type { CommandExecutionRecord } from "../command/types.js";
import type { HandlerExecutionResultRecord, HandlerInvocationRecord } from "../handler-invoke/types.js";
import type { StateMutationRecord } from "../mutation/types.js";
import type { WorkerChainStage } from "./types.js";

export function buildChainHaltNote(input: {
  readonly terminal_stage: WorkerChainStage;
  readonly halt_cause: string;
}): string {
  return `Execution chain halted at ${input.terminal_stage}: ${input.halt_cause}.`;
}

export function buildChainCompletedNote(): string {
  return "Execution chain completed: invoke, command, and mutation stages recorded.";
}

export function buildChainLineageRef(input: {
  readonly authority_record_id: string;
  readonly invocation?: HandlerInvocationRecord;
  readonly handler_result?: HandlerExecutionResultRecord;
  readonly command?: CommandExecutionRecord;
  readonly mutation?: StateMutationRecord;
}): readonly string[] {
  const refs = [input.authority_record_id.trim()];
  if (input.invocation !== undefined) {
    refs.push(input.invocation.invocation_record_id.trim());
  }
  if (input.handler_result !== undefined) {
    refs.push(input.handler_result.result_record_id.trim());
  }
  if (input.command !== undefined) {
    refs.push(input.command.command_record_id.trim());
  }
  if (input.mutation !== undefined) {
    refs.push(input.mutation.mutation_record_id.trim());
  }
  return refs;
}
