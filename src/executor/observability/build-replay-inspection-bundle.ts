/**
 * ReplayInspectionBundle — v1 inspect surfaces over certified projections (read-only).
 * @see docs/product/executor-replay-inspect-surface-contract-v1.md
 */

import { buildDecisionHistoryProjection } from "./build-decision-history-projection.js";
import { buildExplainabilityRecord } from "./build-explainability-record.js";
import { buildReplayInspectionProjection } from "./build-replay-inspection-projection.js";
import { buildTimelineProjection } from "./build-timeline-projection.js";
import { buildTraceProjection } from "./build-trace-projection.js";
import type {
  BuildReplayInspectionBundleInput,
  ReplayInspectSurface,
  ReplayInspectionBundle,
} from "./types.js";
import { ObservabilityRejectedError } from "./types.js";

const V1_SURFACES: readonly ReplayInspectSurface[] = [
  "execution_lineage",
  "trace_references",
  "decision_chain",
  "timeline_references",
  "projection_bundle_export",
  "deterministic_replay_metadata",
];

export function buildReplayInspectionBundle(
  input: BuildReplayInspectionBundleInput,
): ReplayInspectionBundle {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const bundle_id = `inspect-bundle-${result.job_id.slice(0, 12)}-${now.getTime()}`;

  const trace = buildTraceProjection({ worker_result: result, now });

  let timeline;
  try {
    timeline = buildTimelineProjection({ trace, worker_result: result, now });
  } catch (err) {
    if (!(err instanceof ObservabilityRejectedError)) throw err;
  }

  const decision_history = buildDecisionHistoryProjection({
    worker_result: result,
    now,
  });

  let explain;
  if (timeline !== undefined) {
    explain = buildExplainabilityRecord({
      trace,
      timeline,
      worker_result: result,
      now,
    });
  }

  const projection = buildReplayInspectionProjection({
    worker_result: result,
    trace,
    ...(timeline !== undefined ? { timeline: timeline } : {}),
    decision_history,
    ...(explain !== undefined ? { explain: explain } : {}),
    bundle_id,
    now,
  });

  const unavailable_reason =
    projection.inspectability_status === "unavailable"
      ? "Inspect lineage could not be composed from authoritative evidence."
      : projection.inspectability_status === "partial"
        ? "Partial lineage — some projection inputs are missing; inspect references are descriptive only."
        : undefined;

  return {
    bundle_id,
    generated_at: now.toISOString(),
    projection,
    surfaces:     V1_SURFACES,
    payload: {
      trace,
      ...(timeline !== undefined ? { timeline: timeline } : {}),
      ...(explain !== undefined ? { explain: explain } : {}),
      decision_history,
      execution_lineage_refs: trace.source_record_refs,
    },
    ...(unavailable_reason !== undefined ? { unavailable_reason } : {}),
  };
}
