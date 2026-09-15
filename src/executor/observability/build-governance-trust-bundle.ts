/**
 * GovernanceTrustBundle — v1 governance over certified projections (read-only).
 * @see docs/product/executor-execution-governance-surface-contract-v1.md
 */

import { buildCorrelatedTrustSurfaceView } from "./build-correlated-trust-view.js";
import { buildExecutionDiagnosticsBundle } from "./build-execution-diagnostics-bundle.js";
import {
  buildExecutionGovernanceProjection,
  buildGovernanceIndicators,
  deriveGovernanceStatus,
} from "./build-execution-governance-projection.js";
import { filterBundlesInWindow, resolveDiagnosticsWindow } from "./build-execution-diagnostics-projection.js";
import { buildReplayInspectionBundle } from "./build-replay-inspection-bundle.js";
import type {
  BuildGovernanceTrustBundleInput,
  ExecutionGovernanceSurface,
  GovernanceTrustBundle,
} from "./types.js";

const V1_SURFACES: readonly ExecutionGovernanceSurface[] = [
  "invariant_pressure_zones",
  "boundary_proximity_indicators",
  "replay_authority_separation_checks",
  "cross_surface_doctrine_consistency",
  "governance_drift_references",
  "governance_lineage_references",
];

export function buildGovernanceTrustBundle(
  input: BuildGovernanceTrustBundleInput,
): GovernanceTrustBundle {
  const now = input.now ?? new Date();
  const bundle_id = `governance-bundle-${now.getTime()}`;
  const { window_start, window_end, windowStartMs, windowEndMs } =
    resolveDiagnosticsWindow({
      ...(input.window_hours !== undefined ? { window_hours: input.window_hours } : {}),
      now,
    });

  const bundles_in_window = filterBundlesInWindow(
    input.bundles,
    windowStartMs,
    windowEndMs,
  );

  const diagnostics = buildExecutionDiagnosticsBundle({
    bundles:          input.bundles,
    ...(input.anchor_evidence !== undefined ? { anchor_evidence: input.anchor_evidence } : {}),
    ...(input.window_hours !== undefined ? { window_hours: input.window_hours } : {}),
    now,
  });

  const anchorId = input.anchor_evidence?.worker_result.job_id;
  let anchor_correlation;
  let anchor_replay;
  let correlation_reference: string | undefined;
  let replay_inspection_reference: string | undefined;

  if (input.anchor_evidence !== undefined) {
    anchor_correlation = buildCorrelatedTrustSurfaceView({
      worker_result:    input.anchor_evidence.worker_result,
      evidence_bundles: input.bundles,
      ...(input.window_hours !== undefined ? { window_hours: input.window_hours } : {}),
      now,
    });
    correlation_reference = anchor_correlation.projection.correlation_id;

    anchor_replay = buildReplayInspectionBundle({
      worker_result: input.anchor_evidence.worker_result,
      now,
    });
    replay_inspection_reference =
      anchor_replay.projection.inspect_bundle_reference;
  }

  const indicators = buildGovernanceIndicators({
    diagnostics,
    window_start,
    window_end,
    ...(anchor_correlation !== undefined ? { anchor_correlation: anchor_correlation } : {}),
    ...(anchor_replay !== undefined ? { anchor_replay: anchor_replay } : {}),
    ...(anchorId !== undefined ? { anchor_job_id: anchorId } : {}),
  });

  const any_upstream_partial =
    diagnostics.projection.diagnostics_status === "partial" ||
    anchor_correlation?.projection.correlation_status === "partial" ||
    anchor_replay?.projection.inspectability_status === "partial";

  const anchor_requested = input.anchor_evidence !== undefined;
  const governance_status = deriveGovernanceStatus({
    bundles_in_window_count: bundles_in_window.length,
    indicator_count:         indicators.length,
    anchor_requested,
    any_upstream_partial,
  });

  const projection = buildExecutionGovernanceProjection({
    diagnostics_reference:       diagnostics.projection.diagnostics_id,
    window_start,
    window_end,
    indicator_count:             indicators.length,
    governance_status,
    ...(correlation_reference !== undefined ? { correlation_reference: correlation_reference } : {}),
    ...(replay_inspection_reference !== undefined ? { replay_inspection_reference: replay_inspection_reference } : {}),
    ...(anchorId !== undefined ? { anchor_job_id: anchorId } : {}),
    now,
  });

  let unavailable_reason: string | undefined;
  if (governance_status === "unavailable") {
    unavailable_reason =
      "Execution governance unavailable — no evidence in window for deterministic evaluation.";
  } else if (governance_status === "partial") {
    unavailable_reason =
      "Partial governance — some upstream projections or indicators may be missing; descriptive only, never enforcement.";
  }

  return {
    bundle_id,
    generated_at: now.toISOString(),
    projection,
    surfaces:     V1_SURFACES,
    indicators,
    ...(unavailable_reason !== undefined ? { unavailable_reason } : {}),
  };
}
