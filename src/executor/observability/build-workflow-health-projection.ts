/**
 * WorkflowHealthProjectionBuilder — fleet health aggregate (deterministic observer).
 * @see docs/product/executor-workflow-health-surface-contract-v1.md
 */

import { buildWorkflowHealthRecord } from "./build-workflow-health-record.js";
import type {
  BuildWorkflowHealthProjectionInput,
  HealthSignalSeverity,
  HealthSignalType,
  WorkflowHealthProjection,
  WorkflowHealthSignal,
} from "./types.js";
import {
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
} from "./workflow-health-thresholds.js";

const SIGNAL_TYPE_ORDER: readonly HealthSignalType[] = [
  "stalled_chain_detected",
  "retry_spike_detected",
  "pending_duration_exceeded",
  "failure_rate_elevated",
  "queue_pressure_detected",
];

const SEVERITY_ORDER: Record<HealthSignalSeverity, number> = {
  high:   0,
  medium: 1,
  low:    2,
};

function clampWindowHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 1) return DEFAULT_WINDOW_HOURS;
  return Math.min(Math.floor(hours), MAX_WINDOW_HOURS);
}

function filterBundlesInWindow(
  bundles: BuildWorkflowHealthProjectionInput["bundles"],
  windowStartMs: number,
  windowEndMs: number,
): BuildWorkflowHealthProjectionInput["bundles"] {
  return bundles.filter((b) => {
    const t = new Date(b.stored_at).getTime();
    return t >= windowStartMs && t <= windowEndMs;
  });
}

function sortSignals(signals: WorkflowHealthSignal[]): WorkflowHealthSignal[] {
  return [...signals].sort((a, b) => {
    const ti = SIGNAL_TYPE_ORDER.indexOf(a.signal_type);
    const tj = SIGNAL_TYPE_ORDER.indexOf(b.signal_type);
    if (ti !== tj) return ti - tj;
    const si = SEVERITY_ORDER[a.severity];
    const sj = SEVERITY_ORDER[b.severity];
    if (si !== sj) return si - sj;
    return a.observed_at.localeCompare(b.observed_at);
  });
}

export function buildWorkflowHealthProjection(
  input: BuildWorkflowHealthProjectionInput,
): WorkflowHealthProjection {
  const now = input.now ?? new Date();
  const windowHours = clampWindowHours(input.window_hours ?? DEFAULT_WINDOW_HOURS);
  const windowEndMs = now.getTime();
  const windowStartMs = windowEndMs - windowHours * 60 * 60 * 1000;
  const window_start = new Date(windowStartMs).toISOString();
  const window_end = now.toISOString();

  const inWindow = filterBundlesInWindow(
    input.bundles,
    windowStartMs,
    windowEndMs,
  );

  const record = buildWorkflowHealthRecord({
    bundles:               inWindow,
    evidence_window_start: window_start,
    evidence_window_end:   window_end,
    total_store_count:     input.bundles.length,
    now,
  });

  return {
    projection_id:  `health-proj-${now.getTime()}`,
    generated_at:   window_end,
    signals:        sortSignals([...record.signals]),
  };
}

/** Normative alias from observer doctrine. */
export const WorkflowHealthProjectionBuilder = buildWorkflowHealthProjection;
