/**
 * ExecutionDiagnosticsBundle — v1 diagnostics over certified projections (read-only).
 * @see docs/product/executor-execution-diagnostics-surface-contract-v1.md
 */

import {
  buildDiagnosticFindings,
  buildExecutionDiagnosticsProjection,
  deriveDiagnosticsStatus,
  filterBundlesInWindow,
  resolveDiagnosticsWindow,
} from "./build-execution-diagnostics-projection.js";
import { buildCorrelatedTrustSurfaceView } from "./build-correlated-trust-view.js";
import { buildWorkflowHealthProjection } from "./build-workflow-health-projection.js";
import type {
  ExecutionDiagnosticsBundle,
  ExecutionDiagnosticsSurface,
  StoredWorkerEvidence,
} from "./types.js";

const V1_SURFACES: readonly ExecutionDiagnosticsSurface[] = [
  "repeated_halt_clustering",
  "retry_concentration_windows",
  "queue_pressure_hotspots",
  "mutation_instability_zones",
  "decision_refusal_density",
  "diagnostic_lineage_references",
];

export type BuildExecutionDiagnosticsBundleInput = {
  readonly bundles: readonly StoredWorkerEvidence[];
  readonly anchor_evidence?: StoredWorkerEvidence;
  readonly window_hours?: number;
  readonly now?: Date;
};

export function buildExecutionDiagnosticsBundle(
  input: BuildExecutionDiagnosticsBundleInput,
): ExecutionDiagnosticsBundle {
  const now = input.now ?? new Date();
  const bundle_id = `diagnostics-bundle-${now.getTime()}`;
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

  const health = buildWorkflowHealthProjection({
    bundles:      input.bundles,
    ...(input.window_hours !== undefined ? { window_hours: input.window_hours } : {}),
    now,
  });

  const anchorId = input.anchor_evidence?.worker_result.job_id;
  let anchor_correlation;
  let timeline_trust_reference: string | undefined;
  let correlation_reference: string | undefined;

  if (input.anchor_evidence !== undefined) {
    anchor_correlation = buildCorrelatedTrustSurfaceView({
      worker_result:    input.anchor_evidence.worker_result,
      evidence_bundles: input.bundles,
      ...(input.window_hours !== undefined ? { window_hours: input.window_hours } : {}),
      now,
    });
    correlation_reference = anchor_correlation.projection.correlation_id;
    timeline_trust_reference = anchor_correlation.projection.timeline_trust_reference;
  }

  const findings = buildDiagnosticFindings({
    bundles_in_window,
    all_bundles:           input.bundles,
    health,
    window_start,
    window_end,
    ...(anchor_correlation !== undefined ? { anchor_correlation: anchor_correlation } : {}),
  });

  const anchor_requested = input.anchor_evidence !== undefined;
  const diagnostics_status = deriveDiagnosticsStatus({
    bundles_in_window_count: bundles_in_window.length,
    finding_count:           findings.length,
    anchor_requested,
    anchor_resolved:         anchor_requested,
  });

  const projection = buildExecutionDiagnosticsProjection({
    health,
    window_start,
    window_end,
    finding_count:           findings.length,
    diagnostics_status,
    ...(anchorId !== undefined ? { anchor_job_id: anchorId } : {}),
    ...(correlation_reference !== undefined ? { correlation_reference: correlation_reference } : {}),
    ...(timeline_trust_reference !== undefined ? { timeline_trust_reference: timeline_trust_reference } : {}),
    now,
  });

  let unavailable_reason: string | undefined;
  if (diagnostics_status === "unavailable") {
    unavailable_reason =
      "Execution diagnostics unavailable — no evidence in window for deterministic evaluation.";
  } else if (diagnostics_status === "partial") {
    unavailable_reason =
      "Partial diagnostics — some patterns or anchor projections may be missing; descriptive only.";
  }

  return {
    bundle_id,
    generated_at: now.toISOString(),
    projection,
    surfaces:     V1_SURFACES,
    findings,
    ...(unavailable_reason !== undefined ? { unavailable_reason } : {}),
  };
}
