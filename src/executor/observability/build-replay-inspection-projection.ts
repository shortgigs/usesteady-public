/**
 * ReplayInspectionProjection — composes inspect references + deterministic lineage_hash.
 * @see docs/product/executor-replay-inspect-surface-contract-v1.md
 */

import { createHash } from "node:crypto";

import type { WorkerResultRecord } from "../worker/types.js";
import type {
  DecisionHistoryProjection,
  ExecutionExplainabilityRecord,
  ExecutionTimelineProjection,
  ExecutionTraceProjection,
  InspectabilityStatus,
  ReplayInspectionProjection,
} from "./types.js";

export type BuildReplayInspectionProjectionInput = {
  readonly worker_result: WorkerResultRecord;
  readonly trace: ExecutionTraceProjection;
  readonly timeline?: ExecutionTimelineProjection;
  readonly decision_history: DecisionHistoryProjection;
  readonly explain?: ExecutionExplainabilityRecord;
  readonly bundle_id: string;
  readonly now?: Date;
};

function computeLineageHash(input: {
  readonly trace: ExecutionTraceProjection;
  readonly timeline?: ExecutionTimelineProjection;
  readonly decision_history: DecisionHistoryProjection;
}): string {
  const material = [
    ...input.trace.source_record_refs,
    ...(input.timeline?.entries.map((e) => e.record_ref) ?? []),
    ...input.decision_history.entries.map((e) => e.lineage_reference),
  ].sort();
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function replayReference(
  result: WorkerResultRecord,
  explain?: ExecutionExplainabilityRecord,
): string {
  const refs = explain?.replay_lineage_ref ?? [];
  if (refs.length > 0) return refs.join("|");
  const chain = result.execution_chain;
  if (chain !== undefined) return chain.chain_idempotency_key;
  return result.idempotency_key;
}

function resolveInspectabilityStatus(input: {
  readonly worker_result: WorkerResultRecord;
  readonly timeline?: ExecutionTimelineProjection;
  readonly decision_history: DecisionHistoryProjection;
}): InspectabilityStatus {
  const chain = input.worker_result.execution_chain;
  if (input.timeline === undefined) return "partial";
  if (
    chain !== undefined &&
    input.decision_history.entries.length === 0
  ) {
    return "partial";
  }
  if (chain === undefined) return "partial";
  return "available";
}

export function buildReplayInspectionProjection(
  input: BuildReplayInspectionProjectionInput,
): ReplayInspectionProjection {
  const now = input.now ?? new Date();
  const created_at = now.toISOString();
  const job_id = input.worker_result.job_id;

  const inspectability_status = resolveInspectabilityStatus({
    worker_result:     input.worker_result,
    ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
    decision_history:  input.decision_history,
  });

  return {
    replay_reference:            replayReference(input.worker_result, input.explain),
    execution_id:                job_id,
    trace_reference:             `trace:${input.trace.trace_id}`,
    decision_history_reference:  `history:${input.decision_history.history_id}`,
    timeline_reference:
      input.timeline !== undefined
        ? `timeline:${input.timeline.timeline_id}`
        : `timeline:unavailable:${job_id}`,
    inspect_bundle_reference:    `inspect:${input.bundle_id}`,
    lineage_hash:                computeLineageHash({
      trace:            input.trace,
      ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
      decision_history: input.decision_history,
    }),
    created_at,
    inspectability_status,
  };
}
