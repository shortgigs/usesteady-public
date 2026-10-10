/**
 * Derive ExecutionTraceProjection from append-only WorkerResultRecord (read-only).
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type { BuildObservabilityInput, ExecutionTraceProjection } from "./types.js";

function lineageStrings(result: WorkerResultRecord): readonly string[] {
  const chain = result.execution_chain;
  const refs: string[] = [
    result.job_id,
    result.idempotency_key,
    ...result.lineage_ref.map((e) => `${e.kind}:${e.execution_id}`),
  ];
  if (chain !== undefined) {
    refs.push(chain.chain_idempotency_key, chain.authority_record_id);
  }
  return refs;
}

function sourceRecordRefs(result: WorkerResultRecord): readonly string[] {
  const chain = result.execution_chain;
  if (chain === undefined) return [`worker_result:${result.job_id}`];

  const refs: string[] = [`worker_result:${result.job_id}`];
  refs.push(`authority:${chain.authority_record_id}`);
  if (chain.invocation !== undefined) {
    refs.push(`invocation:${chain.invocation.invocation_record_id}`);
  }
  if (chain.handler_result !== undefined) {
    refs.push(`handler_result:${chain.handler_result.result_record_id}`);
  }
  if (chain.command !== undefined) {
    refs.push(`command:${chain.command.command_record_id}`);
  }
  if (chain.mutation !== undefined) {
    refs.push(`mutation:${chain.mutation.mutation_record_id}`);
  }
  return refs;
}

export function buildTraceProjection(
  input: BuildObservabilityInput,
): ExecutionTraceProjection {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const chain = result.execution_chain;

  return {
    trace_id:                        `trace-${result.job_id.slice(0, 12)}-${now.getTime()}`,
    job_id:                          result.job_id,
    worker_result_idempotency_key:   result.idempotency_key,
    terminal_outcome:                result.outcome,
    ...((chain?.authority_record_id) !== undefined ? { authority_record_id: chain?.authority_record_id } : {}),
    ...((chain?.invocation?.invocation_record_id) !== undefined ? { invocation_record_id: chain?.invocation?.invocation_record_id } : {}),
    ...((chain?.handler_result?.result_record_id) !== undefined ? { handler_result_id: chain?.handler_result?.result_record_id } : {}),
    ...((chain?.command?.command_record_id) !== undefined ? { command_record_id: chain?.command?.command_record_id } : {}),
    ...((chain?.mutation?.mutation_record_id) !== undefined ? { mutation_record_id: chain?.mutation?.mutation_record_id } : {}),
    lineage_ref:                     lineageStrings(result),
    recorded_at:                     now.toISOString(),
    source_record_refs:              sourceRecordRefs(result),
  };
}
