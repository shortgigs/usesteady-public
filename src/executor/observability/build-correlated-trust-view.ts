/**
 * CorrelatedTrustSurfaceView — v1 correlated trust over certified projections (read-only).
 * @see docs/product/executor-correlated-trust-surface-contract-v1.md
 */

import {
  buildCorrelatedExecutionTrustProjection,
  buildCorrelationLinks,
  deriveCorrelationTrustStatus,
} from "./build-correlated-trust-projection.js";
import { buildDecisionHistoryProjection } from "./build-decision-history-projection.js";
import { buildTimelineTrustSurfaceView } from "./build-timeline-trust-surface-view.js";
import { buildWorkflowHealthProjection } from "./build-workflow-health-projection.js";
import type {
  BuildCorrelatedTrustSurfaceInput,
  CorrelatedTrustSurface,
  CorrelatedTrustSurfaceView,
} from "./types.js";

const V1_SURFACES: readonly CorrelatedTrustSurface[] = [
  "timeline_health_correlation",
  "halt_mutation_correlation",
  "retry_queue_pressure_correlation",
  "decision_failure_correlation",
  "lineage_linked_evidence",
];

export function buildCorrelatedTrustSurfaceView(
  input: BuildCorrelatedTrustSurfaceInput,
): CorrelatedTrustSurfaceView {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const view_id = `correlation-trust-view-${result.job_id.slice(0, 12)}-${now.getTime()}`;

  const timeline_trust = buildTimelineTrustSurfaceView({
    worker_result: result,
    now,
  });

  const decision_history = buildDecisionHistoryProjection({
    worker_result: result,
    now,
  });

  const bundles = input.evidence_bundles ?? [];
  const health = buildWorkflowHealthProjection({
    bundles,
    window_hours: input.window_hours ?? 24,
    now,
  });

  const timeline =
    timeline_trust.timeline.entries.length > 0
      ? timeline_trust.timeline
      : undefined;

  const links = buildCorrelationLinks({
    job_id:                    result.job_id,
    worker_result:             result,
    timeline_trust_projection: timeline_trust.projection,
    timeline_events:           timeline_trust.events,
    timeline,
    health,
    decision_history,
  });

  const correlation_status = deriveCorrelationTrustStatus({
    timeline_status: timeline_trust.projection.trust_status,
    link_count:      links.length,
  });

  const projection = buildCorrelatedExecutionTrustProjection({
    worker_result:             result,
    timeline_trust_projection: timeline_trust.projection,
    health,
    decision_history,
    link_count:                links.length,
    correlation_status,
    now,
  });

  let unavailable_reason: string | undefined;
  if (correlation_status === "unavailable") {
    unavailable_reason =
      "Correlated trust surface unavailable — authoritative timeline or correlation evidence is missing.";
  } else if (correlation_status === "partial") {
    unavailable_reason =
      "Partial correlation — some signals or stages may be missing; descriptive only.";
  }

  return {
    view_id,
    generated_at: now.toISOString(),
    projection,
    surfaces:     V1_SURFACES,
    links,
    ...(unavailable_reason !== undefined ? { unavailable_reason } : {}),
  };
}
