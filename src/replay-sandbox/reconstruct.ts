/**
 * Deterministic replay sandbox reconstruction from ExecutionRecord snapshot only.
 * @see docs/product/executor-replay-execution-sandbox-contract-v1.md
 */

import type { ExecutionLineageEntry, ExecutionRecord } from "../executor/runtime/types.js";
import type { WorkerResultRecord } from "../executor/worker/types.js";
import { REPLAY_SANDBOX_VERSION } from "./constants.js";
import { replaySandboxId } from "./replay-id.js";
import type {
  ReplaySandboxCandidate,
  ReplaySandboxJob,
  ReplaySandboxReconstructedInputs,
  ReplaySandboxState,
} from "./types.js";

function lineageRefs(lineage: readonly ExecutionLineageEntry[]): readonly string[] {
  return lineage.map((e) => `${e.kind}@${e.at}${e.note !== undefined ? `:${e.note}` : ""}`);
}

function resolveReplayState(execution: ExecutionRecord): ReplaySandboxState {
  const reason = execution.reason.toLowerCase();
  const blocking = execution.blocking_cause.toLowerCase();
  if (
    reason.includes("expired") ||
    blocking.includes("expired") ||
    reason.includes("eligibility_expired")
  ) {
    return "expired";
  }
  if (execution.outcome !== "completed") {
    return "blocked";
  }
  if (blocking.trim().length > 0) {
    return "blocked";
  }
  return "candidate";
}

function reconstructedInputs(
  execution: ExecutionRecord,
): ReplaySandboxReconstructedInputs {
  return {
    executor_eligibility_record_id: execution.executor_eligibility_record_id,
    capability_id:                  execution.capability_id,
    capability_eligibility_record_id: execution.capability_eligibility_record_id,
    executed_at:                    execution.executed_at,
    executed_by:                    execution.executed_by,
    outcome:                        execution.outcome,
    reason:                         execution.reason,
    blocking_cause:                 execution.blocking_cause,
  };
}

/**
 * Reconstruct an isolated replay sandbox candidate from an execution snapshot.
 * Read-only — no network, filesystem, handlers, workers, or executor invocation.
 */
export function reconstructReplaySandbox(job: ReplaySandboxJob): ReplaySandboxCandidate {
  const execution = job.execution;
  const reconstructed_capability_id = execution.capability_id.trim();
  const execution_id = execution.execution_id.trim();

  if (execution_id.length === 0 || reconstructed_capability_id.length === 0) {
    throw new Error("Execution snapshot is incomplete for replay sandbox reconstruction.");
  }

  const replay_sandbox_id = replaySandboxId({
    execution_id,
    reconstructed_capability_id,
    replay_version: REPLAY_SANDBOX_VERSION,
  });

  return {
    replay_sandbox_id,
    execution_id,
    reconstructed_capability_id,
    reconstructed_inputs: reconstructedInputs(execution),
    replay_state:         resolveReplayState(execution),
    replay_lineage:       lineageRefs(execution.lineage),
    replay_generated_at:  execution.executed_at,
    replay_version:       REPLAY_SANDBOX_VERSION,
  };
}

/**
 * Derive a read-only ExecutionRecord snapshot from worker evidence (transport only).
 * Does not call the proposal executor or any execution runtime.
 */
export function deriveExecutionRecordSnapshot(
  worker_result: WorkerResultRecord,
): ExecutionRecord | undefined {
  const chain = worker_result.execution_chain;
  const invocation = chain?.invocation;
  if (chain === undefined || invocation === undefined) {
    return undefined;
  }

  const outcome: ExecutionRecord["outcome"] =
    worker_result.outcome === "execution_chain_completed"
      ? "completed"
      : worker_result.outcome === "execution_chain_halted"
        ? "failed"
        : "aborted";

  const executed_at = worker_result.processed_at;
  const lineage: ExecutionLineageEntry[] = [
    {
      at:   executed_at,
      kind: "gate_passed",
      note: "derived from worker evidence — sandbox read path only",
    },
    {
      at:   executed_at,
      kind: "execution_started",
    },
    {
      at:   executed_at,
      kind:
        outcome === "completed"
          ? "execution_completed"
          : outcome === "failed"
            ? "execution_failed"
            : "execution_aborted",
      ...(chain.halt_cause !== undefined ? { note: chain.halt_cause } : {}),
    },
  ];

  for (const ref of worker_result.lineage_ref) {
    lineage.push({
      at:   ref.at,
      kind: "gate_passed",
      note: `${ref.kind}:${ref.execution_id}`,
    });
  }

  return {
    execution_id: invocation.execution_id.trim().length > 0
      ? invocation.execution_id.trim()
      : worker_result.job_id,
    executor_eligibility_record_id: chain.authority_record_id,
    capability_id:                  invocation.authorization_scope.capability_id,
    capability_eligibility_record_id: invocation.handler_intent_id,
    executed_at,
    executed_by:                    "operator",
    outcome,
    reason:                         worker_result.note,
    blocking_cause:                 chain.halt_cause ?? "",
    lineage,
  };
}
