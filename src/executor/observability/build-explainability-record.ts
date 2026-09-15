/**
 * Derive ExecutionExplainabilityRecord from trace + timeline (descriptive only).
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type {
  ExecutionExplainabilityRecord,
  ExecutionTimelineProjection,
  ExecutionTraceProjection,
} from "./types.js";

function mutationExplain(result: WorkerResultRecord): string | undefined {
  const mutation = result.execution_chain?.mutation;
  if (mutation === undefined) return undefined;
  if (mutation.decision === "applied") {
    return `Mutation was applied (record ${mutation.mutation_record_id}).`;
  }
  return `Mutation was denied: ${mutation.denial_cause ?? "unspecified"} (record ${mutation.mutation_record_id}).`;
}

function chainStageSummary(result: WorkerResultRecord): readonly string[] {
  const chain = result.execution_chain;
  if (chain === undefined) return ["No execution chain evidence attached to worker result."];

  const lines: string[] = [];
  if (chain.invocation !== undefined) {
    lines.push(
      `Handler invocation ${chain.invocation.decision} at ${chain.invocation.invoked_at}.`,
    );
  }
  if (chain.handler_result !== undefined) {
    lines.push(`Handler result ${chain.handler_result.outcome}.`);
  }
  if (chain.command !== undefined) {
    lines.push(`Command ${chain.command.decision} (${chain.command.command_scope.command_class}).`);
  }
  if (chain.mutation !== undefined) {
    lines.push(`Mutation ${chain.mutation.decision}.`);
  }
  return lines;
}

function replayLineage(result: WorkerResultRecord): readonly string[] {
  const chain = result.execution_chain;
  const refs: string[] = [result.idempotency_key];
  if (chain !== undefined) {
    refs.push(chain.chain_idempotency_key);
    if (chain.invocation !== undefined) {
      refs.push(chain.invocation.invocation_idempotency_key);
    }
    if (chain.command !== undefined) {
      refs.push(chain.command.command_idempotency_key);
    }
    if (chain.mutation !== undefined) {
      refs.push(chain.mutation.mutation_idempotency_key);
    }
  }
  return refs;
}

function buildSummary(
  result: WorkerResultRecord,
  timeline: ExecutionTimelineProjection,
): string {
  const chain = result.execution_chain;
  if (chain === undefined) {
    return `Worker transport recorded outcome ${result.outcome} at ${result.processed_at}. No chain evidence for deeper explainability.`;
  }
  if (result.outcome === "execution_chain_completed") {
    return `Execution chain completed at stage ${chain.terminal_stage} (${timeline.entries.length} timeline entries).`;
  }
  if (result.outcome === "execution_chain_halted") {
    return `Execution chain halted at stage ${chain.terminal_stage}: ${chain.halt_cause ?? "unspecified"}.`;
  }
  return `Worker outcome ${result.outcome}; terminal stage ${chain.terminal_stage}.`;
}

export function buildExplainabilityRecord(input: {
  readonly trace: ExecutionTraceProjection;
  readonly timeline: ExecutionTimelineProjection;
  readonly worker_result: WorkerResultRecord;
  readonly now?: Date;
  readonly descriptive_replay?: boolean;
}): ExecutionExplainabilityRecord {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const chain = result.execution_chain;

  const mutation_decision_explain = mutationExplain(result);
  return {
    explain_id:                 `explain-${result.job_id.slice(0, 12)}-${now.getTime()}`,
    job_id:                     result.job_id,
    summary:                    buildSummary(result, input.timeline),
    ...(mutation_decision_explain !== undefined ? { mutation_decision_explain: mutation_decision_explain } : {}),
    ...(chain?.authority_record_id !== undefined ? { authority_consumed_ref: chain?.authority_record_id } : {}),
    chain_stage_summary:        chainStageSummary(result),
    terminal_stage:             input.timeline.terminal_stage,
    ...(chain?.halt_cause !== undefined ? { halt_cause: chain?.halt_cause } : {}),
    replay_lineage_ref:         replayLineage(result),
    recorded_at:                now.toISOString(),
    ...(input.descriptive_replay !== undefined ? { descriptive_replay: input.descriptive_replay } : {}),
  };
}
