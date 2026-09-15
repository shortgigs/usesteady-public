/**
 * Derive ExecutionSummaryProjection from WorkerResultRecord + timeline (list row).
 * @see docs/product/executor-execution-timeline-surface-contract-v1.md
 */

import type { WorkerResultRecord } from "../worker/types.js";
import { buildExplainabilityRecord } from "./build-explainability-record.js";
import { buildTimelineProjection } from "./build-timeline-projection.js";
import { buildTraceProjection } from "./build-trace-projection.js";
import type {
  BuildExecutionSummaryInput,
  ExecutionSummaryProjection,
  ExecutionSummaryStatus,
} from "./types.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function durationFromTimeline(
  entries: readonly { readonly at: string }[],
): number | undefined {
  if (entries.length === 0) return undefined;
  const times = entries.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  if (times.length < 2) return 0;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return Math.max(0, max - min);
}

function deriveOwner(result: WorkerResultRecord): string {
  const chain = result.execution_chain;
  return (
    chain?.command?.actor_id ??
    chain?.mutation?.actor_id ??
    "unknown"
  );
}

function deriveAuthorityReference(result: WorkerResultRecord): string | undefined {
  const chain = result.execution_chain;
  if (chain?.command?.actor_id !== undefined || chain?.mutation?.actor_id !== undefined) {
    return "operator_gate";
  }
  if (chain?.authority_record_id !== undefined) return "operator_gate";
  return undefined;
}

function deriveRejectionCause(result: WorkerResultRecord): string | undefined {
  const chain = result.execution_chain;
  return (
    chain?.halt_cause ??
    chain?.mutation?.denial_cause ??
    chain?.command?.denial_cause ??
    chain?.invocation?.denial_cause
  );
}

function deriveStatus(result: WorkerResultRecord): ExecutionSummaryStatus {
  const chain = result.execution_chain;
  if (chain?.command?.decision === "denied" || chain?.mutation?.decision === "denied") {
    return "denied";
  }
  if (result.outcome === "execution_chain_halted" || chain?.terminal_stage === "halted") {
    return "halted";
  }
  if (result.outcome === "execution_chain_completed") return "completed";
  if (
    result.outcome === "transport_failed" ||
    result.outcome === "dead_letter"
  ) {
    return "halted";
  }
  return "halted";
}

function deriveTitle(result: WorkerResultRecord): string {
  const trimmed = result.note.trim();
  if (trimmed.length > 0) return trimmed;
  return `Execution ${result.job_id}`;
}

export function buildExecutionSummaryProjection(
  input: BuildExecutionSummaryInput,
): ExecutionSummaryProjection {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const trace = buildTraceProjection({ worker_result: result, now });
  const timeline = buildTimelineProjection({ trace, worker_result: result, now });
  const explain = buildExplainabilityRecord({
    trace,
    timeline,
    worker_result:      result,
    now,
    descriptive_replay: true,
  });

  const duration_ms = durationFromTimeline(timeline.entries);
  const replay_available =
    explain.replay_lineage_ref.length > 1 && explain.descriptive_replay === true;

  const authority_reference = deriveAuthorityReference(result);
  const rejection_cause = deriveRejectionCause(result);
  return {
    execution_id:        result.job_id,
    job_id:              result.job_id,
    title:               deriveTitle(result),
    status:              deriveStatus(result),
    owner:               deriveOwner(result),
    ...(duration_ms !== undefined ? { duration_ms: duration_ms } : {}),
    ...(duration_ms !== undefined ? { duration_display: formatDuration(duration_ms) } : {}),
    ...(authority_reference !== undefined ? { authority_reference: authority_reference } : {}),
    ...(rejection_cause !== undefined ? { rejection_cause: rejection_cause } : {}),
    replay_available,
    created_at:          input.stored_at,
    timeline_id:         timeline.timeline_id,
  };
}
