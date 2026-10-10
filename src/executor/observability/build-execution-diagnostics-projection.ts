/**
 * ExecutionDiagnosticsProjection — deterministic fleet diagnostics (read-only).
 * @see docs/product/executor-execution-diagnostics-surface-contract-v1.md
 */

import type { WorkerResultRecord } from "../worker/types.js";
import { buildCorrelationLinks } from "./build-correlated-trust-projection.js";
import { buildDecisionHistoryProjection } from "./build-decision-history-projection.js";
import { buildTimelineTrustSurfaceView } from "./build-timeline-trust-surface-view.js";
import {
  EXECUTION_DIAGNOSTICS_RULE_VERSION,
  HALT_CLUSTER_MIN_COUNT,
  MUTATION_INSTABILITY_MIN_JOBS,
  REFUSAL_DENSITY_MIN_COUNT,
} from "./execution-diagnostics-thresholds.js";
import type {
  CorrelatedTrustSurfaceView,
  DiagnosticFinding,
  DiagnosticFindingKind,
  DiagnosticsStatus,
  ExecutionDiagnosticsProjection,
  ExecutionDiagnosticsSurface,
  StoredWorkerEvidence,
  WorkflowHealthProjection,
} from "./types.js";
import {
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
} from "./workflow-health-thresholds.js";

const KIND_SORT_PRIORITY: Record<DiagnosticFindingKind, number> = {
  lineage_diagnostic:    0,
  halt_cluster:          1,
  retry_window:          2,
  queue_hotspot:         3,
  mutation_instability:  4,
  refusal_density:       5,
};

export type BuildDiagnosticFindingsInput = {
  readonly bundles_in_window: readonly StoredWorkerEvidence[];
  readonly all_bundles: readonly StoredWorkerEvidence[];
  readonly health: WorkflowHealthProjection;
  readonly window_start: string;
  readonly window_end: string;
  readonly anchor_correlation?: CorrelatedTrustSurfaceView;
};

function clampWindowHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 1) return DEFAULT_WINDOW_HOURS;
  return Math.min(Math.floor(hours), MAX_WINDOW_HOURS);
}

export function filterBundlesInWindow(
  bundles: readonly StoredWorkerEvidence[],
  windowStartMs: number,
  windowEndMs: number,
): StoredWorkerEvidence[] {
  return bundles.filter((b) => {
    const t = new Date(b.stored_at).getTime();
    return t >= windowStartMs && t <= windowEndMs;
  });
}

function isHaltedResult(result: WorkerResultRecord): boolean {
  if (result.outcome === "execution_chain_halted") return true;
  const chain = result.execution_chain;
  return chain?.terminal_stage === "halted" || chain?.mutation?.decision === "denied";
}

function isRefusalEntry(decision: string, stage: string): boolean {
  if (stage === "halted") return true;
  const d = decision.toLowerCase();
  return d.includes("denied") || d.includes("refused");
}

export function sortDiagnosticFindings(
  findings: readonly DiagnosticFinding[],
): DiagnosticFinding[] {
  return [...findings].sort((a, b) => {
    const t = a.observed_at.localeCompare(b.observed_at);
    if (t !== 0) return t;
    return KIND_SORT_PRIORITY[a.kind] - KIND_SORT_PRIORITY[b.kind];
  });
}

export function deriveDiagnosticsStatus(input: {
  readonly bundles_in_window_count: number;
  readonly finding_count: number;
  readonly anchor_requested: boolean;
  readonly anchor_resolved: boolean;
}): DiagnosticsStatus {
  if (input.bundles_in_window_count === 0 && input.finding_count === 0) {
    return "unavailable";
  }
  if (input.anchor_requested && !input.anchor_resolved) {
    return "partial";
  }
  if (input.finding_count === 0) {
    return "partial";
  }
  return "available";
}

function buildHaltClusterFindings(input: BuildDiagnosticFindingsInput): DiagnosticFinding[] {
  const halted = input.bundles_in_window.filter((b) =>
    isHaltedResult(b.worker_result),
  );
  if (halted.length < HALT_CLUSTER_MIN_COUNT) return [];

  const jobIds = halted.map((b) => b.worker_result.job_id);
  return [
    {
      finding_id:       `edf-halt-${input.window_end}-${halted.length}`,
      kind:             "halt_cluster",
      label:            "Repeated halt clustering",
      surface:          "repeated_halt_clustering",
      evidence_ref:     `evidence:window;job_ids:${jobIds.slice(0, 8).join(",")}`,
      projection_ref:   input.health.projection_id,
      observed_at:      input.window_end,
      rule_reference:   `${EXECUTION_DIAGNOSTICS_RULE_VERSION}/halt_cluster`,
      window_start:     input.window_start,
      window_end:       input.window_end,
      count:            halted.length,
      note:             `${halted.length} halted outcome(s) in window — count only.`,
    },
  ];
}

function buildRetryWindowFindings(input: BuildDiagnosticFindingsInput): DiagnosticFinding[] {
  const retrySignal = input.health.signals.find(
    (s) => s.signal_type === "retry_spike_detected",
  );
  if (retrySignal === undefined) return [];

  const correlation = input.anchor_correlation;
  const hasRetryCorrelation =
    correlation?.links.some((l) => l.kind === "retry_queue_pressure") ?? false;

  if (correlation !== undefined && !hasRetryCorrelation) {
    return [];
  }

  const correlationRef =
    correlation !== undefined ? correlation.view_id : "correlation:none";

  return [
    {
      finding_id:       `edf-retry-${input.window_end}`,
      kind:             "retry_window",
      label:            "Retry concentration window",
      surface:          "retry_concentration_windows",
      evidence_ref:     retrySignal.health_signal_id,
      projection_ref:   `${input.health.projection_id};${correlationRef}`,
      observed_at:      retrySignal.observed_at,
      rule_reference:   `${EXECUTION_DIAGNOSTICS_RULE_VERSION}/retry_window`,
      window_start:     input.window_start,
      window_end:       input.window_end,
      count:            retrySignal.affected_execution_count,
      note:             "Health retry spike — count correlation only.",
    },
  ];
}

function buildQueueHotspotFindings(input: BuildDiagnosticFindingsInput): DiagnosticFinding[] {
  return input.health.signals
    .filter((s) => s.signal_type === "queue_pressure_detected")
    .map((signal) => ({
      finding_id:       `edf-queue-${signal.health_signal_id}`,
      kind:             "queue_hotspot" as const,
      label:            "Queue-pressure hotspot",
      surface:          "queue_pressure_hotspots" as const,
      evidence_ref:     signal.lineage_reference,
      projection_ref:   input.health.projection_id,
      observed_at:      signal.observed_at,
      rule_reference:   `${EXECUTION_DIAGNOSTICS_RULE_VERSION}/queue_hotspot`,
      window_start:     input.window_start,
      window_end:       input.window_end,
      count:            signal.affected_execution_count,
      note:             "Descriptive queue pressure — no routing implication.",
    }));
}

function buildMutationInstabilityFindings(
  input: BuildDiagnosticFindingsInput,
): DiagnosticFinding[] {
  let unstableJobs = 0;
  const jobRefs: string[] = [];

  for (const bundle of input.bundles_in_window) {
    if (!isHaltedResult(bundle.worker_result)) continue;
    try {
      const timeline_trust = buildTimelineTrustSurfaceView({
        worker_result: bundle.worker_result,
      });
      const timeline =
        timeline_trust.timeline.entries.length > 0
          ? timeline_trust.timeline
          : undefined;
      const decision_history = buildDecisionHistoryProjection({
        worker_result: bundle.worker_result,
      });
      const links = buildCorrelationLinks({
        job_id:                    bundle.worker_result.job_id,
        worker_result:             bundle.worker_result,
        timeline_trust_projection: timeline_trust.projection,
        timeline_events:           timeline_trust.events,
        timeline,
        health:                    input.health,
        decision_history,
      });
      if (links.some((l) => l.kind === "halt_mutation")) {
        unstableJobs += 1;
        jobRefs.push(bundle.worker_result.job_id);
      }
    } catch {
      continue;
    }
  }

  if (unstableJobs < MUTATION_INSTABILITY_MIN_JOBS) return [];

  return [
    {
      finding_id:       `edf-mut-${input.window_end}-${unstableJobs}`,
      kind:             "mutation_instability",
      label:            "Mutation instability zone",
      surface:          "mutation_instability_zones",
      evidence_ref:     `evidence:mutation_instability;jobs:${jobRefs.join(",")}`,
      projection_ref:   input.health.projection_id,
      observed_at:      input.window_end,
      rule_reference:   `${EXECUTION_DIAGNOSTICS_RULE_VERSION}/mutation_instability`,
      window_start:     input.window_start,
      window_end:       input.window_end,
      count:            unstableJobs,
      note:             "Mutation or command preceded halt — preceded language only.",
    },
  ];
}

function buildRefusalDensityFindings(input: BuildDiagnosticFindingsInput): DiagnosticFinding[] {
  let refusalCount = 0;
  const refs: string[] = [];

  for (const bundle of input.bundles_in_window) {
    try {
      const history = buildDecisionHistoryProjection({
        worker_result: bundle.worker_result,
      });
      for (const entry of history.entries) {
        if (isRefusalEntry(entry.decision, entry.stage)) {
          refusalCount += 1;
          refs.push(entry.lineage_reference);
        }
      }
    } catch {
      continue;
    }
  }

  if (refusalCount < REFUSAL_DENSITY_MIN_COUNT) return [];

  return [
    {
      finding_id:       `edf-refusal-${input.window_end}-${refusalCount}`,
      kind:             "refusal_density",
      label:            "Decision refusal density",
      surface:          "decision_refusal_density",
      evidence_ref:     `evidence:refusals;count=${refusalCount}`,
      projection_ref:   input.health.projection_id,
      observed_at:      input.window_end,
      rule_reference:   `${EXECUTION_DIAGNOSTICS_RULE_VERSION}/refusal_density`,
      window_start:     input.window_start,
      window_end:       input.window_end,
      count:            refusalCount,
      note:             `Descriptive density — ${refs.length} lineage ref(s) cited.`,
    },
  ];
}

function buildLineageDiagnosticFindings(
  findings: DiagnosticFinding[],
  health: WorkflowHealthProjection,
  anchor_correlation?: CorrelatedTrustSurfaceView,
): DiagnosticFinding[] {
  const lineage: DiagnosticFinding[] = [];
  for (const parent of findings) {
    if (parent.kind === "lineage_diagnostic") continue;
    lineage.push({
      finding_id:       `edf-lineage-${parent.finding_id}`,
      kind:             "lineage_diagnostic",
      label:            "Diagnostic lineage reference",
      surface:          "diagnostic_lineage_references",
      evidence_ref:     parent.evidence_ref,
      projection_ref:   anchor_correlation !== undefined
        ? `${health.projection_id};${anchor_correlation.view_id};${parent.projection_ref}`
        : `${health.projection_id};${parent.projection_ref}`,
      observed_at:      parent.observed_at,
      rule_reference:   `${EXECUTION_DIAGNOSTICS_RULE_VERSION}/lineage_diagnostic`,
      window_start:     parent.window_start,
      window_end:       parent.window_end,
      note:             `Lineage anchor for ${parent.finding_id}`,
    });
  }
  return lineage;
}

export function buildDiagnosticFindings(
  input: BuildDiagnosticFindingsInput,
): DiagnosticFinding[] {
  const raw: DiagnosticFinding[] = [
    ...buildHaltClusterFindings(input),
    ...buildRetryWindowFindings(input),
    ...buildQueueHotspotFindings(input),
    ...buildMutationInstabilityFindings(input),
    ...buildRefusalDensityFindings(input),
  ];

  const withLineage = [
    ...raw,
    ...buildLineageDiagnosticFindings(
      raw,
      input.health,
      input.anchor_correlation,
    ),
  ];

  const seen = new Set<string>();
  const deduped = withLineage.filter((f) => {
    const key = `${f.kind}|${f.surface}|${f.evidence_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return f.evidence_ref.length > 0 && f.projection_ref.length > 0;
  });

  return sortDiagnosticFindings(deduped);
}

export function buildExecutionDiagnosticsProjection(input: {
  readonly health: WorkflowHealthProjection;
  readonly window_start: string;
  readonly window_end: string;
  readonly finding_count: number;
  readonly diagnostics_status: DiagnosticsStatus;
  readonly anchor_job_id?: string;
  readonly correlation_reference?: string;
  readonly timeline_trust_reference?: string;
  readonly now?: Date;
}): ExecutionDiagnosticsProjection {
  const now = input.now ?? new Date();
  return {
    diagnostics_id:              `diag-${now.getTime()}`,
    evidence_window_start:       input.window_start,
    evidence_window_end:         input.window_end,
    health_projection_reference: input.health.projection_id,
    finding_count:               input.finding_count,
    diagnostics_status:          input.diagnostics_status,
    created_at:                  now.toISOString(),
    ...(input.correlation_reference !== undefined
      ? { correlation_reference: input.correlation_reference }
      : {}),
    ...(input.timeline_trust_reference !== undefined
      ? { timeline_trust_reference: input.timeline_trust_reference }
      : {}),
    ...(input.anchor_job_id !== undefined
      ? { anchor_job_id: input.anchor_job_id }
      : {}),
  };
}

export function resolveDiagnosticsWindow(input: {
  readonly window_hours?: number;
  readonly now?: Date;
}): { window_start: string; window_end: string; windowStartMs: number; windowEndMs: number } {
  const now = input.now ?? new Date();
  const windowHours = clampWindowHours(input.window_hours ?? DEFAULT_WINDOW_HOURS);
  const windowEndMs = now.getTime();
  const windowStartMs = windowEndMs - windowHours * 60 * 60 * 1000;
  return {
    window_start:  new Date(windowStartMs).toISOString(),
    window_end:    now.toISOString(),
    windowStartMs,
    windowEndMs,
  };
}
