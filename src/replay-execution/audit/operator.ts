/**
 * Resolve operator_id from worker evidence (INV-PREX-AUDIT-9).
 */

import type { WorkerResultRecord } from "../../executor/worker/types.js";

export function resolveOperatorIdFromWorkerResult(
  worker_result: WorkerResultRecord,
): string | undefined {
  const chain = worker_result.execution_chain;
  if (chain === undefined) return undefined;

  const fromCommand = chain.command?.actor_id?.trim();
  if (fromCommand !== undefined && fromCommand.length > 0) {
    return fromCommand;
  }

  const fromMutation = chain.mutation?.actor_id?.trim();
  if (fromMutation !== undefined && fromMutation.length > 0) {
    return fromMutation;
  }

  return undefined;
}
