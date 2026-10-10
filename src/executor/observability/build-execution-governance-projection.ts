/**
 * ExecutionGovernanceProjection — deterministic governance visibility (read-only).
 * @see docs/product/executor-execution-governance-surface-contract-v1.md
 */

import {
  EXECUTION_GOVERNANCE_RULE_VERSION,
  INVARIANT_PRESSURE_FINDING_KINDS,
  POLICY_REF_INV_COR_8,
  POLICY_REF_INV_EDX_8,
  POLICY_REF_INV_GOV_8,
  POLICY_REF_INV_WHO_11,
} from "./execution-governance-thresholds.js";
import type {
  CorrelatedTrustSurfaceView,
  DiagnosticFindingKind,
  ExecutionDiagnosticsBundle,
  ExecutionGovernanceProjection,
  GovernanceIndicator,
  GovernanceIndicatorKind,
  GovernanceTrustStatus,
  ReplayInspectionBundle,
} from "./types.js";

const KIND_SORT_PRIORITY: Record<GovernanceIndicatorKind, number> = {
  invariant_pressure:          0,
  boundary_proximity:          1,
  replay_authority_separation: 2,
  doctrine_consistency:        3,
  governance_drift:            4,
  governance_lineage:          5,
};

export type BuildGovernanceIndicatorsInput = {
  readonly diagnostics: ExecutionDiagnosticsBundle;
  readonly window_start: string;
  readonly window_end: string;
  readonly anchor_correlation?: CorrelatedTrustSurfaceView;
  readonly anchor_replay?: ReplayInspectionBundle;
  readonly anchor_job_id?: string;
};

export function deriveGovernanceStatus(input: {
  readonly bundles_in_window_count: number;
  readonly indicator_count: number;
  readonly anchor_requested: boolean;
  readonly any_upstream_partial: boolean;
}): GovernanceTrustStatus {
  if (input.bundles_in_window_count === 0 && input.indicator_count === 0) {
    return "unavailable";
  }
  if (input.anchor_requested && input.any_upstream_partial) {
    return "partial";
  }
  if (input.any_upstream_partial || input.indicator_count === 0) {
    return "partial";
  }
  return "available";
}

export function sortGovernanceIndicators(
  indicators: readonly GovernanceIndicator[],
): GovernanceIndicator[] {
  return [...indicators].sort((a, b) => {
    const t = a.observed_at.localeCompare(b.observed_at);
    if (t !== 0) return t;
    return KIND_SORT_PRIORITY[a.kind] - KIND_SORT_PRIORITY[b.kind];
  });
}

function isPressureKind(kind: DiagnosticFindingKind): boolean {
  return (INVARIANT_PRESSURE_FINDING_KINDS as readonly string[]).includes(kind);
}

function correlationRoutingRefs(
  correlation?: CorrelatedTrustSurfaceView,
): string[] {
  if (correlation === undefined) return [];
  return correlation.links.flatMap((l) => [l.left_ref, l.right_ref]);
}

function buildInvariantPressureIndicators(
  input: BuildGovernanceIndicatorsInput,
): GovernanceIndicator[] {
  const pressure = input.diagnostics.findings.filter((f) =>
    isPressureKind(f.kind),
  );
  if (pressure.length === 0) return [];

  const refs = pressure.map((f) => f.finding_id).join(",");
  return [
    {
      indicator_id:     `gov-pressure-${input.window_end}-${pressure.length}`,
      kind:               "invariant_pressure",
      label:              "Invariant pressure zone",
      surface:            "invariant_pressure_zones",
      policy_reference:   `${POLICY_REF_INV_WHO_11};${POLICY_REF_INV_EDX_8};${POLICY_REF_INV_COR_8}`,
      evidence_ref:       `evidence:diagnostics;findings:${refs}`,
      projection_ref:     input.diagnostics.projection.diagnostics_id,
      observed_at:        input.window_end,
      rule_reference:     `${EXECUTION_GOVERNANCE_RULE_VERSION}/invariant_pressure`,
      window_start:       input.window_start,
      window_end:         input.window_end,
      count:              pressure.length,
      note:               "Recurring diagnostic pressure — visibility only, not enforcement.",
    },
  ];
}

function buildBoundaryProximityIndicators(
  input: BuildGovernanceIndicatorsInput,
): GovernanceIndicator[] {
  const correlation = input.anchor_correlation;
  if (correlation === undefined) return [];
  if (input.diagnostics.findings.length === 0) return [];

  const replay = input.anchor_replay;
  const inspectPartial =
    replay === undefined ||
    replay.projection.inspectability_status !== "available";

  if (!inspectPartial) return [];

  const jobId = input.anchor_job_id ?? correlation.projection.execution_id;
  return [
    {
      indicator_id:     `gov-boundary-${input.window_end}-${jobId.slice(0, 8)}`,
      kind:               "boundary_proximity",
      label:              "Boundary proximity indicator",
      surface:            "boundary_proximity_indicators",
      policy_reference:   POLICY_REF_INV_WHO_11,
      evidence_ref:       `evidence:job_id:${jobId};correlation:${correlation.view_id}`,
      projection_ref:     `${input.diagnostics.projection.diagnostics_id};${correlation.projection.correlation_id}`,
      observed_at:        input.window_end,
      rule_reference:     `${EXECUTION_GOVERNANCE_RULE_VERSION}/boundary_proximity`,
      window_start:       input.window_start,
      window_end:         input.window_end,
      note:               "Correlation and diagnostics co-present; inspect partial or absent — proximity only, no routing.",
    },
  ];
}

function buildReplayAuthoritySeparationIndicators(
  input: BuildGovernanceIndicatorsInput,
): GovernanceIndicator[] {
  const replay = input.anchor_replay;
  if (replay === undefined) return [];

  const routingRefs = correlationRoutingRefs(input.anchor_correlation);
  const replayRef = replay.projection.replay_reference;
  const overlaps = routingRefs.some((r) => r === replayRef);

  return [
    {
      indicator_id:     `gov-replay-sep-${replay.projection.execution_id.slice(0, 8)}`,
      kind:               "replay_authority_separation",
      label:              "Replay / authority separation check",
      surface:            "replay_authority_separation_checks",
      policy_reference:   POLICY_REF_INV_GOV_8,
      evidence_ref:       `evidence:replay_reference:${replayRef}`,
      projection_ref:     `${replay.projection.inspect_bundle_reference};${replay.projection.lineage_hash}`,
      observed_at:        replay.projection.created_at,
      rule_reference:     `${EXECUTION_GOVERNANCE_RULE_VERSION}/replay_authority_separation`,
      window_start:       input.window_start,
      window_end:         input.window_end,
      note:               overlaps
        ? "Inspect replay_reference overlaps correlation ref material — inspect ≠ execute; separation visibility only."
        : "Inspect replay_reference distinct from correlation routing refs — inspect ≠ execute.",
    },
  ];
}

function buildDoctrineConsistencyIndicators(
  input: BuildGovernanceIndicatorsInput,
): GovernanceIndicator[] {
  const diag = input.diagnostics.projection;
  const correlation = input.anchor_correlation;
  const replay = input.anchor_replay;
  if (correlation === undefined || replay === undefined) return [];

  const jobId = input.anchor_job_id ?? correlation.projection.execution_id;
  const idsAlign =
    correlation.projection.execution_id === replay.projection.execution_id &&
    (diag.anchor_job_id === undefined || diag.anchor_job_id === jobId);

  if (!idsAlign) return [];

  return [
    {
      indicator_id:     `gov-doctrine-${jobId.slice(0, 8)}-${diag.diagnostics_id.slice(-6)}`,
      kind:               "doctrine_consistency",
      label:              "Cross-surface doctrine consistency",
      surface:            "cross_surface_doctrine_consistency",
      policy_reference:   `${POLICY_REF_INV_WHO_11};${POLICY_REF_INV_GOV_8}`,
      evidence_ref:       `evidence:job_id:${jobId};lineage:${replay.projection.lineage_hash}`,
      projection_ref:     `${diag.diagnostics_id};${correlation.projection.correlation_id};${replay.projection.inspect_bundle_reference}`,
      observed_at:        input.window_end,
      rule_reference:     `${EXECUTION_GOVERNANCE_RULE_VERSION}/doctrine_consistency`,
      window_start:       input.window_start,
      window_end:         input.window_end,
      note:               "Diagnostics, correlation, and inspect projections align to same job_id — consistency visibility only.",
    },
  ];
}

function buildGovernanceDriftIndicators(
  input: BuildGovernanceIndicatorsInput,
): GovernanceIndicator[] {
  const diagStatus = input.diagnostics.projection.diagnostics_status;
  const corrStatus = input.anchor_correlation?.projection.correlation_status;
  const inspectStatus = input.anchor_replay?.projection.inspectability_status;

  const partial =
    diagStatus === "partial" ||
    corrStatus === "partial" ||
    inspectStatus === "partial";

  if (!partial) return [];

  const parts: string[] = [];
  if (diagStatus === "partial") parts.push("diagnostics:partial");
  if (corrStatus === "partial") parts.push("correlation:partial");
  if (inspectStatus === "partial") parts.push("inspect:partial");

  return [
    {
      indicator_id:     `gov-drift-${input.window_end}`,
      kind:               "governance_drift",
      label:              "Governance drift reference",
      surface:            "governance_drift_references",
      policy_reference:   POLICY_REF_INV_GOV_8,
      evidence_ref:       `evidence:drift;${parts.join(";")}`,
      projection_ref:     input.diagnostics.projection.diagnostics_id,
      observed_at:        input.window_end,
      rule_reference:     `${EXECUTION_GOVERNANCE_RULE_VERSION}/governance_drift`,
      window_start:       input.window_start,
      window_end:         input.window_end,
      note:               "Upstream projection partial — drift visibility, not correction.",
    },
  ];
}

function buildGovernanceLineageIndicators(
  indicators: GovernanceIndicator[],
): GovernanceIndicator[] {
  const lineage: GovernanceIndicator[] = [];
  for (const parent of indicators) {
    if (parent.kind === "governance_lineage") continue;
    lineage.push({
      indicator_id:     `gov-lineage-${parent.indicator_id}`,
      kind:               "governance_lineage",
      label:              "Governance lineage reference",
      surface:            "governance_lineage_references",
      policy_reference:   POLICY_REF_INV_GOV_8,
      evidence_ref:       parent.evidence_ref,
      projection_ref:     `${parent.projection_ref};${parent.policy_reference}`,
      observed_at:        parent.observed_at,
      rule_reference:     `${EXECUTION_GOVERNANCE_RULE_VERSION}/governance_lineage`,
      window_start:       parent.window_start,
      window_end:         parent.window_end,
      note:               `Lineage anchor for ${parent.indicator_id}`,
    });
  }
  return lineage;
}

export function buildGovernanceIndicators(
  input: BuildGovernanceIndicatorsInput,
): GovernanceIndicator[] {
  const raw: GovernanceIndicator[] = [
    ...buildInvariantPressureIndicators(input),
    ...buildBoundaryProximityIndicators(input),
    ...buildReplayAuthoritySeparationIndicators(input),
    ...buildDoctrineConsistencyIndicators(input),
    ...buildGovernanceDriftIndicators(input),
  ];

  const withLineage = [...raw, ...buildGovernanceLineageIndicators(raw)];

  const seen = new Set<string>();
  const deduped = withLineage.filter((ind) => {
    const key = `${ind.kind}|${ind.surface}|${ind.evidence_ref}|${ind.projection_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return (
      ind.evidence_ref.length > 0 &&
      ind.projection_ref.length > 0 &&
      ind.policy_reference.length > 0
    );
  });

  return sortGovernanceIndicators(deduped);
}

export function buildExecutionGovernanceProjection(input: {
  readonly diagnostics_reference: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly indicator_count: number;
  readonly governance_status: GovernanceTrustStatus;
  readonly correlation_reference?: string;
  readonly replay_inspection_reference?: string;
  readonly anchor_job_id?: string;
  readonly now?: Date;
}): ExecutionGovernanceProjection {
  const now = input.now ?? new Date();
  return {
    governance_id:              `gov-${now.getTime()}`,
    evidence_window_start:      input.window_start,
    evidence_window_end:        input.window_end,
    diagnostics_reference:      input.diagnostics_reference,
    indicator_count:            input.indicator_count,
    governance_status:          input.governance_status,
    created_at:                 now.toISOString(),
    ...(input.correlation_reference !== undefined
      ? { correlation_reference: input.correlation_reference }
      : {}),
    ...(input.replay_inspection_reference !== undefined
      ? { replay_inspection_reference: input.replay_inspection_reference }
      : {}),
    ...(input.anchor_job_id !== undefined
      ? { anchor_job_id: input.anchor_job_id }
      : {}),
  };
}
