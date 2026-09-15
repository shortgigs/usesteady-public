/**
 * TimelineTrustSurfaceView — v1 trust surfaces over certified projections (read-only).
 * @see docs/product/executor-execution-timeline-trust-surface-contract-v1.md
 */

import { buildDecisionHistoryProjection } from "./build-decision-history-projection.js";
import { buildTimelineProjection } from "./build-timeline-projection.js";
import { buildTraceProjection } from "./build-trace-projection.js";
import {
  buildTimelineTrustEvents,
  buildTimelineTrustSurfaceProjection,
} from "./build-timeline-trust-surface-projection.js";
import type {
  BuildTimelineTrustSurfaceInput,
  TimelineTrustSurface,
  TimelineTrustSurfaceView,
} from "./types.js";
import { ObservabilityRejectedError } from "./types.js";

const V1_SURFACES: readonly TimelineTrustSurface[] = [
  "ordered_execution_stages",
  "stage_timing",
  "authority_checkpoints",
  "mutation_checkpoints",
  "halt_boundaries",
  "projection_lineage_references",
];

export function buildTimelineTrustSurfaceView(
  input: BuildTimelineTrustSurfaceInput,
): TimelineTrustSurfaceView {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const view_id = `timeline-trust-view-${result.job_id.slice(0, 12)}-${now.getTime()}`;

  const trace = buildTraceProjection({ worker_result: result, now });

  let timeline;
  try {
    timeline = buildTimelineProjection({ trace, worker_result: result, now });
  } catch (err) {
    if (!(err instanceof ObservabilityRejectedError)) {
      throw err;
    }
  }

  const decision_history = buildDecisionHistoryProjection({
    worker_result: result,
    now,
  });

  const events =
    timeline !== undefined
      ? buildTimelineTrustEvents({ trace, timeline, decision_history })
      : [];

  const projection = buildTimelineTrustSurfaceProjection({
    worker_result: result,
    trace,
    ...(timeline !== undefined ? { timeline: timeline } : {}),
    decision_history,
    events,
    now,
  });

  if (timeline === undefined) {
    return {
      view_id,
      generated_at: now.toISOString(),
      projection,
      surfaces:     V1_SURFACES,
      events:       [],
      timeline: {
        timeline_id:    projection.timeline_reference,
        job_id:         result.job_id,
        entries:        [],
        terminal_stage: "halted",
        recorded_at:    now.toISOString(),
      },
      unavailable_reason:
        "Timeline trust surface could not be composed — authoritative timeline evidence is missing.",
    };
  }

  const unavailable_reason =
    projection.trust_status === "unavailable"
      ? "Timeline trust surface unavailable for this execution."
      : projection.trust_status === "partial"
        ? "Partial timeline — some stages or decision points may be missing; descriptive only."
        : undefined;

  return {
    view_id,
    generated_at: now.toISOString(),
    projection,
    surfaces:     V1_SURFACES,
    events,
    timeline,
    ...(unavailable_reason !== undefined ? { unavailable_reason } : {}),
  };
}
