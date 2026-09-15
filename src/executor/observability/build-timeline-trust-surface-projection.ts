/**
 * TimelineTrustSurfaceProjection — event-ordered trust view (read-only).
 * @see docs/product/executor-execution-timeline-trust-surface-contract-v1.md
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type {
  DecisionHistoryProjection,
  ExecutionTimelineEntry,
  ExecutionTimelineProjection,
  ExecutionTraceProjection,
  TimelineTrustEvent,
  TimelineTrustEventKind,
  TimelineTrustStatus,
  TimelineTrustSurfaceProjection,
} from "./types.js";

const KIND_SORT_PRIORITY: Record<TimelineTrustEventKind, number> = {
  lineage_anchor:       0,
  stage_marker:         1,
  state_transition:     2,
  decision_point:       3,
  refusal_point:        4,
  health_snapshot_ref:  5,
};

const STAGE_LABELS: Record<ExecutionTimelineEntry["kind"], string> = {
  worker_terminal:     "Worker terminal",
  authority_consumed:  "Authority checkpoint",
  handler_invoked:     "Handler invoked",
  command_executed:    "Command checkpoint",
  mutation_applied:    "Mutation checkpoint",
  halted:              "Halt boundary",
};

function isRefusalDecision(decision: string | undefined): boolean {
  if (decision === undefined) return false;
  const d = decision.toLowerCase();
  return d.includes("denied") || d.includes("refused") || d.includes("rejected");
}

function stageMarkerEvent(
  entry: ExecutionTimelineEntry,
  job_id: string,
  index: number,
): TimelineTrustEvent {
  return {
    event_id:   `tte-stage-${job_id.slice(0, 8)}-${index}`,
    at:         entry.at,
    kind:       "stage_marker",
    label:      STAGE_LABELS[entry.kind],
    record_ref: entry.record_ref,
    ...(entry.decision !== undefined ? { decision: entry.decision } : {}),
    ...(entry.note !== undefined ? { note: entry.note } : {}),
  };
}

function refusalFromEntry(
  entry: ExecutionTimelineEntry,
  job_id: string,
  index: number,
): TimelineTrustEvent | undefined {
  if (!isRefusalDecision(entry.decision) && entry.kind !== "halted") {
    return undefined;
  }
  return {
    event_id:        `tte-refusal-${job_id.slice(0, 8)}-${index}`,
    at:              entry.at,
    kind:            "refusal_point",
    label:           entry.kind === "halted" ? "Halt boundary" : "Refusal point",
    record_ref:      entry.record_ref,
    refusal_reason:  entry.note ?? entry.decision ?? "refused",
    ...(entry.decision !== undefined ? { decision: entry.decision } : {}),
  };
}

export function buildTimelineTrustEvents(input: {
  readonly trace: ExecutionTraceProjection;
  readonly timeline: ExecutionTimelineProjection;
  readonly decision_history: DecisionHistoryProjection;
}): TimelineTrustEvent[] {
  const events: TimelineTrustEvent[] = [];
  const job_id = input.timeline.job_id;

  for (const ref of input.trace.lineage_ref) {
    events.push({
      event_id:    `tte-lineage-${job_id.slice(0, 8)}-${events.length}`,
      at:          input.trace.recorded_at,
      kind:        "lineage_anchor",
      label:       "Lineage reference",
      record_ref:  `trace:${input.trace.trace_id}`,
      lineage_ref: ref,
    });
  }

  const sorted = [...input.timeline.entries];
  let priorKind: ExecutionTimelineEntry["kind"] | undefined;

  sorted.forEach((entry, index) => {
    events.push(stageMarkerEvent(entry, job_id, index));

    if (priorKind !== undefined && priorKind !== entry.kind) {
      events.push({
        event_id:     `tte-transition-${job_id.slice(0, 8)}-${index}`,
        at:           entry.at,
        kind:         "state_transition",
        label:        "State transition",
        record_ref:   entry.record_ref,
        prior_state:  priorKind,
        next_state:   entry.kind,
      });
    }
    priorKind = entry.kind;

    const refusal = refusalFromEntry(entry, job_id, index);
    if (refusal !== undefined) {
      events.push(refusal);
    }
  });

  input.decision_history.entries.forEach((entry, index) => {
    events.push({
      event_id:    `tte-decision-${job_id.slice(0, 8)}-${index}`,
      at:          entry.timestamp,
      kind:        "decision_point",
      label:       `Decision — ${entry.stage.replace(/_/g, " ")}`,
      record_ref:  entry.lineage_reference,
      decision:    entry.decision,
      ...(entry.replay_reference !== undefined ? { lineage_ref: entry.replay_reference } : {}),
      ...(entry.reason !== undefined ? { note: entry.reason } : {}),
    });
    if (isRefusalDecision(entry.decision)) {
      events.push({
        event_id:       `tte-dec-refusal-${job_id.slice(0, 8)}-${index}`,
        at:             entry.timestamp,
        kind:           "refusal_point",
        label:          "Refusal point",
        record_ref:     entry.lineage_reference,
        refusal_reason: entry.reason ?? entry.decision,
        decision:       entry.decision,
      });
    }
  });

  return [...events].sort((a, b) => {
    const byAt = a.at.localeCompare(b.at);
    if (byAt !== 0) return byAt;
    return KIND_SORT_PRIORITY[a.kind] - KIND_SORT_PRIORITY[b.kind];
  });
}

export function deriveTimelineTrustStatus(input: {
  readonly timeline?: ExecutionTimelineProjection;
  readonly event_count: number;
}): TimelineTrustStatus {
  if (input.timeline === undefined) {
    return "unavailable";
  }
  if (input.event_count === 0) {
    return "partial";
  }
  if (input.timeline.entries.length === 0) {
    return "partial";
  }
  return "available";
}

export function buildTimelineTrustSurfaceProjection(input: {
  readonly worker_result: WorkerResultRecord;
  readonly trace: ExecutionTraceProjection;
  readonly timeline?: ExecutionTimelineProjection;
  readonly decision_history: DecisionHistoryProjection;
  readonly events: readonly TimelineTrustEvent[];
  readonly now?: Date;
}): TimelineTrustSurfaceProjection {
  const now = input.now ?? new Date();
  const job_id = input.worker_result.job_id;
  const trust_status = deriveTimelineTrustStatus({
    ...(input.timeline !== undefined ? { timeline: input.timeline } : {}),
    event_count:  input.events.length,
  });

  return {
    trust_timeline_id:          `trust-timeline-${job_id.slice(0, 12)}-${now.getTime()}`,
    execution_id:               job_id,
    trace_reference:            input.trace.trace_id,
    timeline_reference:         input.timeline?.timeline_id ?? `timeline-unavailable-${job_id}`,
    decision_history_reference: input.decision_history.history_id,
    event_count:                input.events.length,
    trust_status,
    created_at:                 now.toISOString(),
  };
}
