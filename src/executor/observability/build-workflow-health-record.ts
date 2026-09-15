/**
 * WorkflowHealthRecord — deterministic rule evaluation over evidence stream.
 * @see docs/product/executor-workflow-health-surface-contract-v1.md
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type {
  HealthSignalSeverity,
  HealthSignalType,
  StoredWorkerEvidence,
  WorkflowHealthRecord,
  WorkflowHealthSignal,
} from "./types.js";
import {
  FAILURE_RATE_MIN_SAMPLES,
  FAILURE_RATE_THRESHOLD,
  PENDING_DURATION_MS,
  QUEUE_PRESSURE_MIN_BUNDLES,
  RETRY_SPIKE_MIN_COUNT,
  STALLED_CHAIN_AGE_MS,
  WORKFLOW_HEALTH_RULE_VERSION,
} from "./workflow-health-thresholds.js";

export type BuildWorkflowHealthRecordInput = {
  readonly bundles: readonly StoredWorkerEvidence[];
  readonly evidence_window_start: string;
  readonly evidence_window_end: string;
  readonly total_store_count: number;
  readonly now?: Date;
};

function msBetween(isoStart: string, isoEnd: string): number {
  return new Date(isoEnd).getTime() - new Date(isoStart).getTime();
}

function severityFromRatio(ratio: number): HealthSignalSeverity {
  if (ratio >= 0.6) return "high";
  if (ratio >= 0.3) return "medium";
  return "low";
}

function makeSignal(input: {
  signal_type: HealthSignalType;
  count: number;
  threshold_reference: string;
  observed_value: string;
  window_end: string;
  job_ids: readonly string[];
  severity?: HealthSignalSeverity;
  explain_job_id?: string;
}): WorkflowHealthSignal {
  const severity =
    input.severity ??
    severityFromRatio(
      input.count / Math.max(1, input.job_ids.length),
    );
  const lineage_reference = `window:end=${input.window_end};job_ids:${input.job_ids.slice(0, 8).join(",")}${input.job_ids.length > 8 ? ",…" : ""}`;
  const signal: WorkflowHealthSignal = {
    health_signal_id:     `${input.signal_type}-${input.window_end}-${WORKFLOW_HEALTH_RULE_VERSION}`,
    signal_type:          input.signal_type,
    severity,
    affected_execution_count: input.count,
    threshold_reference:  input.threshold_reference,
    observed_value:       input.observed_value,
    observed_at:          input.window_end,
    lineage_reference,
  };
  if (input.explain_job_id !== undefined) {
    return {
      ...signal,
      explainability_reference: `/api/executor/observability/explain/${encodeURIComponent(input.explain_job_id)}`,
    };
  }
  return signal;
}

function isFailureOutcome(result: WorkerResultRecord): boolean {
  if (
    result.outcome === "transport_failed" ||
    result.outcome === "dead_letter" ||
    result.outcome === "execution_chain_halted"
  ) {
    return true;
  }
  const chain = result.execution_chain;
  if (chain?.terminal_stage === "halted") return true;
  if (chain?.mutation?.decision === "denied") return true;
  return false;
}

function isStalled(result: WorkerResultRecord, stored_at: string, window_end: string): boolean {
  if (result.outcome === "execution_chain_halted") return true;
  const chain = result.execution_chain;
  if (chain === undefined) return false;
  if (chain.terminal_stage === "halted") return true;
  if (chain.mutation?.decision === "denied") return true;
  if (chain.terminal_stage === "mutation_applied") return false;
  const age = msBetween(stored_at, window_end);
  return age > STALLED_CHAIN_AGE_MS;
}

function isPending(result: WorkerResultRecord, stored_at: string, window_end: string): boolean {
  if (result.outcome === "awaiting_execution_authority") return true;
  if (result.outcome !== "transport_completed") return false;
  const age = msBetween(stored_at, window_end);
  return age > PENDING_DURATION_MS && result.execution_chain === undefined;
}

export function buildWorkflowHealthRecord(
  input: BuildWorkflowHealthRecordInput,
): WorkflowHealthRecord {
  const now = input.now ?? new Date();
  const evaluated_at = now.toISOString();
  const window_end = input.evidence_window_end;

  const stalledIds: string[] = [];
  const pendingIds: string[] = [];
  let retryCount = 0;
  let failureCount = 0;

  for (const bundle of input.bundles) {
    const { worker_result: r, stored_at } = bundle;
    if (isStalled(r, stored_at, window_end)) stalledIds.push(r.job_id);
    if (isPending(r, stored_at, window_end)) pendingIds.push(r.job_id);
    if (r.outcome === "idempotent_skip" || r.outcome === "transport_failed") {
      retryCount += 1;
    }
    if (isFailureOutcome(r)) failureCount += 1;
  }

  const total = input.bundles.length;
  const signals: WorkflowHealthSignal[] = [];

  if (stalledIds.length > 0) {
    signals.push(
      makeSignal({
        signal_type:         "stalled_chain_detected",
        count:               stalledIds.length,
        threshold_reference: `stalled_chain_age_ms:${STALLED_CHAIN_AGE_MS}`,
        observed_value:      `${stalledIds.length} stalled chain(s)`,
        window_end,
        job_ids:             stalledIds,
        ...((stalledIds[0]) !== undefined ? { explain_job_id: stalledIds[0] } : {}),
      }),
    );
  }

  if (retryCount >= RETRY_SPIKE_MIN_COUNT) {
    const retryJobs = input.bundles
      .filter(
        (b) =>
          b.worker_result.outcome === "idempotent_skip" ||
          b.worker_result.outcome === "transport_failed",
      )
      .map((b) => b.worker_result.job_id);
    signals.push(
      makeSignal({
        signal_type:         "retry_spike_detected",
        count:               retryCount,
        threshold_reference: `retry_spike_min_count:${RETRY_SPIKE_MIN_COUNT}`,
        observed_value:      `${retryCount} retry-class outcomes`,
        window_end,
        job_ids:             retryJobs,
        severity:            retryCount >= RETRY_SPIKE_MIN_COUNT * 2 ? "high" : "medium",
      }),
    );
  }

  if (pendingIds.length > 0) {
    signals.push(
      makeSignal({
        signal_type:         "pending_duration_exceeded",
        count:               pendingIds.length,
        threshold_reference: `pending_duration_ms:${PENDING_DURATION_MS}`,
        observed_value:      `${pendingIds.length} pending execution(s)`,
        window_end,
        job_ids:             pendingIds,
        ...((pendingIds[0]) !== undefined ? { explain_job_id: pendingIds[0] } : {}),
      }),
    );
  }

  if (total >= FAILURE_RATE_MIN_SAMPLES) {
    const rate = failureCount / total;
    if (rate >= FAILURE_RATE_THRESHOLD) {
      const failJobs = input.bundles
        .filter((b) => isFailureOutcome(b.worker_result))
        .map((b) => b.worker_result.job_id);
      signals.push(
        makeSignal({
          signal_type:         "failure_rate_elevated",
          count:               failureCount,
          threshold_reference: `failure_rate_threshold:${FAILURE_RATE_THRESHOLD}`,
          observed_value:      `${(rate * 100).toFixed(1)}% failure rate (${failureCount}/${total})`,
          window_end,
          job_ids:             failJobs,
          severity:            rate >= 0.6 ? "high" : "medium",
        }),
      );
    }
  }

  if (input.total_store_count >= QUEUE_PRESSURE_MIN_BUNDLES) {
    signals.push(
      makeSignal({
        signal_type:         "queue_pressure_detected",
        count:               input.total_store_count,
        threshold_reference: `queue_pressure_min_bundles:${QUEUE_PRESSURE_MIN_BUNDLES}`,
        observed_value:      `${input.total_store_count} evidence bundle(s) in store`,
        window_end,
        job_ids:             input.bundles.map((b) => b.worker_result.job_id),
        severity:            input.total_store_count >= QUEUE_PRESSURE_MIN_BUNDLES * 2 ? "high" : "medium",
      }),
    );
  }

  return {
    record_id:              `health-record-${now.getTime()}`,
    evaluated_at,
    evidence_window_start:  input.evidence_window_start,
    evidence_window_end:    window_end,
    rule_version:           WORKFLOW_HEALTH_RULE_VERSION,
    signals,
  };
}
