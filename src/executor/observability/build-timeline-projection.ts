/**
 * Derive ExecutionTimelineProjection from trace + WorkerResultRecord (lineage order only).
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type {
  ExecutionTimelineEntry,
  ExecutionTimelineProjection,
  ExecutionTraceProjection,
} from "./types.js";
import { ObservabilityRejectedError } from "./types.js";

const STAGE_ORDER: readonly ExecutionTimelineEntry["kind"][] = [
  "worker_terminal",
  "authority_consumed",
  "handler_invoked",
  "command_executed",
  "mutation_applied",
  "halted",
];

function sortEntries(entries: ExecutionTimelineEntry[]): ExecutionTimelineEntry[] {
  return [...entries].sort((a, b) => {
    const ai = STAGE_ORDER.indexOf(a.kind);
    const bi = STAGE_ORDER.indexOf(b.kind);
    if (ai !== bi) return ai - bi;
    return a.at.localeCompare(b.at);
  });
}

export function buildTimelineProjection(input: {
  readonly trace: ExecutionTraceProjection;
  readonly worker_result: WorkerResultRecord;
  readonly now?: Date;
}): ExecutionTimelineProjection {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const chain = result.execution_chain;

  const entries: ExecutionTimelineEntry[] = [
    {
      at:         result.processed_at,
      kind:       "worker_terminal",
      record_ref: `worker_result:${result.job_id}`,
      decision:   result.outcome,
      note:       result.note,
    },
  ];

  if (chain === undefined) {
    if (
      result.outcome === "execution_chain_completed" ||
      result.outcome === "execution_chain_halted"
    ) {
      throw new ObservabilityRejectedError(
        "chain_evidence_missing",
        "Worker result claims chain outcome but execution_chain evidence is absent.",
      );
    }
    return {
      timeline_id:    `timeline-${result.job_id.slice(0, 12)}-${now.getTime()}`,
      job_id:         result.job_id,
      entries:        sortEntries(entries),
      terminal_stage: "halted",
      recorded_at:    now.toISOString(),
    };
  }

  const authorityAt = chain.invocation?.invoked_at ?? result.processed_at;
  entries.push({
    at:         authorityAt,
    kind:       "authority_consumed",
    record_ref: `authority:${chain.authority_record_id}`,
    note:       "Authority consumed read-only by worker chain.",
  });

  if (chain.invocation !== undefined) {
    const handlerNote =
      chain.handler_result !== undefined
        ? `${chain.handler_result.outcome}: ${chain.handler_result.result_summary}`
        : chain.invocation.denial_cause;
    entries.push({
      at:         chain.invocation.invoked_at,
      kind:       "handler_invoked",
      record_ref: `invocation:${chain.invocation.invocation_record_id}`,
      decision:   chain.invocation.decision,
      ...((handlerNote) !== undefined ? { note: handlerNote } : {}),
    });
  }

  if (chain.command !== undefined) {
    entries.push({
      at:         chain.command.decided_at,
      kind:       "command_executed",
      record_ref: `command:${chain.command.command_record_id}`,
      decision:   chain.command.decision,
      note:       chain.command.denial_cause ?? chain.command.reason,
    });
  }

  if (chain.mutation !== undefined) {
    entries.push({
      at:         chain.mutation.applied_at,
      kind:       "mutation_applied",
      record_ref: `mutation:${chain.mutation.mutation_record_id}`,
      decision:   chain.mutation.decision,
      note:       chain.mutation.denial_cause ?? chain.mutation.reason,
    });
  }

  if (chain.halt_cause !== undefined && chain.terminal_stage === "halted") {
    entries.push({
      at:         result.processed_at,
      kind:       "halted",
      record_ref: `halt:${chain.chain_idempotency_key}`,
      note:       chain.halt_cause,
    });
  }

  return {
    timeline_id:    `timeline-${result.job_id.slice(0, 12)}-${now.getTime()}`,
    job_id:         result.job_id,
    entries:        sortEntries(entries),
    terminal_stage: chain.terminal_stage,
    recorded_at:    now.toISOString(),
  };
}
