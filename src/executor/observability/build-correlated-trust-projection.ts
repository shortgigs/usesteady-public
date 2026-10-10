/**
 * CorrelatedExecutionTrustProjection — deterministic correlation links (read-only).
 * @see docs/product/executor-correlated-trust-surface-contract-v1.md
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type {
  CorrelationTrustKind,
  CorrelationTrustLink,
  CorrelationTrustStatus,
  CorrelatedExecutionTrustProjection,
  DecisionHistoryProjection,
  ExecutionTimelineEntry,
  ExecutionTimelineProjection,
  TimelineTrustEvent,
  TimelineTrustSurfaceProjection,
  WorkflowHealthProjection,
  WorkflowHealthSignal,
} from "./types.js";

const KIND_SORT_PRIORITY: Record<CorrelationTrustKind, number> = {
  lineage_evidence:       0,
  timeline_health:        1,
  halt_mutation:          2,
  retry_queue_pressure:   3,
  decision_failure:       4,
};

const RULE_VERSION = "correlated-trust-v1";

export function sortCorrelationLinks(
  links: readonly CorrelationTrustLink[],
): CorrelationTrustLink[] {
  return [...links].sort((a, b) => {
    const t = a.observed_at.localeCompare(b.observed_at);
    if (t !== 0) return t;
    return KIND_SORT_PRIORITY[a.kind] - KIND_SORT_PRIORITY[b.kind];
  });
}

export function deriveCorrelationTrustStatus(input: {
  readonly timeline_status: TimelineTrustSurfaceProjection["trust_status"];
  readonly link_count: number;
}): CorrelationTrustStatus {
  if (input.timeline_status === "unavailable" && input.link_count === 0) {
    return "unavailable";
  }
  if (input.timeline_status === "partial" || input.link_count === 0) {
    return "partial";
  }
  return "available";
}

function healthSignalsForJob(
  signals: readonly WorkflowHealthSignal[],
  job_id: string,
): WorkflowHealthSignal[] {
  const encoded = encodeURIComponent(job_id);
  return signals.filter(
    (s) =>
      s.lineage_reference.includes(job_id) ||
      (s.explainability_reference?.includes(encoded) ?? false),
  );
}

function timelineEntryRef(
  job_id: string,
  entry: ExecutionTimelineEntry,
  index: number,
): string {
  return `timeline-entry:${job_id}:${entry.kind}:${index}`;
}

function buildTimelineHealthLinks(input: {
  readonly job_id: string;
  readonly events: readonly TimelineTrustEvent[];
  readonly health_signals: readonly WorkflowHealthSignal[];
}): CorrelationTrustLink[] {
  const links: CorrelationTrustLink[] = [];
  const trustEvents = input.events.filter(
    (e) =>
      e.kind === "refusal_point" ||
      e.kind === "health_snapshot_ref" ||
      (e.kind === "stage_marker" && e.label.includes("Halt")),
  );

  for (const event of trustEvents) {
    for (const signal of input.health_signals) {
      const sharesJob =
        signal.lineage_reference.includes(input.job_id) ||
        (event.lineage_ref?.includes(input.job_id) ?? false);
      if (!sharesJob) continue;

      links.push({
        correlation_link_id: `ctl-th-${input.job_id.slice(0, 8)}-${event.event_id.slice(-6)}-${signal.signal_type}`,
        kind:                  "timeline_health",
        label:                 "Timeline ↔ Health (cite only)",
        left_ref:              event.record_ref,
        right_ref:             signal.health_signal_id,
        observed_at:           event.at,
        rule_reference:        `${RULE_VERSION}/timeline_health`,
        note:                  "Descriptive link — no causation claim.",
      });
    }
  }
  return links;
}

function buildHaltMutationLinks(input: {
  readonly job_id: string;
  readonly timeline: ExecutionTimelineProjection | undefined;
}): CorrelationTrustLink[] {
  if (input.timeline === undefined) return [];

  const entries = [...input.timeline.entries].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const haltIndex = entries.findIndex((e) => e.kind === "halted");
  if (haltIndex < 0) return [];

  let priorMutation: { entry: ExecutionTimelineEntry; index: number } | undefined;
  for (let i = haltIndex - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === "mutation_applied" || e.kind === "command_executed") {
      priorMutation = { entry: e, index: i };
      break;
    }
  }
  if (priorMutation === undefined) return [];

  const haltEntry = entries[haltIndex]!;
  return [
    {
      correlation_link_id: `ctl-hm-${input.job_id.slice(0, 8)}-${haltIndex}`,
      kind:                "halt_mutation",
      label:               "Halt ↔ Mutation (preceded)",
      left_ref:            timelineEntryRef(
        input.job_id,
        priorMutation.entry,
        priorMutation.index,
      ),
      right_ref:           timelineEntryRef(input.job_id, haltEntry, haltIndex),
      observed_at:         haltEntry.at,
      rule_reference:      `${RULE_VERSION}/halt_mutation`,
      note:                "Mutation or command stage preceded halt — descriptive only.",
    },
  ];
}

function buildRetryQueuePressureLinks(input: {
  readonly job_id: string;
  readonly health_signals: readonly WorkflowHealthSignal[];
  readonly decision_history: DecisionHistoryProjection;
}): CorrelationTrustLink[] {
  const pressureSignals = input.health_signals.filter(
    (s) =>
      s.signal_type === "retry_spike_detected" ||
      s.signal_type === "queue_pressure_detected",
  );
  if (pressureSignals.length === 0) return [];

  const retryEntries = input.decision_history.entries.filter(
    (e) =>
      (e.replay_reference?.length ?? 0) > 0 ||
      e.lineage_reference.includes("retry") ||
      (e.reason?.toLowerCase().includes("retry") ?? false),
  );
  if (retryEntries.length === 0) return [];

  const links: CorrelationTrustLink[] = [];
  for (const signal of pressureSignals) {
    for (const entry of retryEntries) {
      links.push({
        correlation_link_id: `ctl-rq-${input.job_id.slice(0, 8)}-${signal.signal_type}-${entry.stage}`,
        kind:                "retry_queue_pressure",
        label:               "Retry ↔ Queue pressure (count correlation)",
        left_ref:            signal.health_signal_id,
        right_ref:           entry.lineage_reference,
        observed_at:         entry.timestamp,
        rule_reference:      `${RULE_VERSION}/retry_queue_pressure`,
        note:                "Count correlation only — no routing implication.",
      });
    }
  }
  return links;
}

function buildDecisionFailureLinks(input: {
  readonly job_id: string;
  readonly decision_history: DecisionHistoryProjection;
  readonly worker_result: WorkerResultRecord;
}): CorrelationTrustLink[] {
  const terminalRef = `terminal-outcome:${input.worker_result.outcome}`;
  const decisionEvents = input.decision_history.entries.filter(
    (e) =>
      e.stage === "halted" ||
      e.decision.toLowerCase().includes("denied") ||
      e.decision.toLowerCase().includes("refused"),
  );

  return decisionEvents.map((entry, index) => ({
    correlation_link_id: `ctl-df-${input.job_id.slice(0, 8)}-${entry.stage}-${index}`,
    kind:                "decision_failure",
    label:               "Decision ↔ Terminal outcome",
    left_ref:            entry.lineage_reference,
    right_ref:           terminalRef,
    observed_at:         entry.timestamp,
    rule_reference:      `${RULE_VERSION}/decision_failure`,
    note:                `Terminal outcome: ${input.worker_result.outcome}`,
  }));
}

function buildLineageEvidenceLinks(input: {
  readonly job_id: string;
  readonly events: readonly TimelineTrustEvent[];
  readonly decision_history: DecisionHistoryProjection;
}): CorrelationTrustLink[] {
  const anchors = input.events.filter((e) => e.kind === "lineage_anchor");
  const links: CorrelationTrustLink[] = [];

  for (const anchor of anchors) {
    for (const entry of input.decision_history.entries) {
      const anchorRef = anchor.lineage_ref ?? anchor.record_ref;
      if (
        !entry.lineage_reference.includes(input.job_id) &&
        !anchorRef.includes(entry.stage)
      ) {
        continue;
      }
      links.push({
        correlation_link_id: `ctl-le-${input.job_id.slice(0, 8)}-${anchor.event_id}-${entry.stage}`,
        kind:                "lineage_evidence",
        label:               "Lineage-linked evidence",
        left_ref:            anchor.record_ref,
        right_ref:           entry.lineage_reference,
        observed_at:         anchor.at,
        rule_reference:      `${RULE_VERSION}/lineage_evidence`,
      });
    }
  }
  return links;
}

export type BuildCorrelationLinksInput = {
  readonly job_id: string;
  readonly worker_result: WorkerResultRecord;
  readonly timeline_trust_projection: TimelineTrustSurfaceProjection;
  readonly timeline_events: readonly TimelineTrustEvent[];
  readonly timeline: ExecutionTimelineProjection | undefined;
  readonly health: WorkflowHealthProjection;
  readonly decision_history: DecisionHistoryProjection;
};

export function buildCorrelationLinks(
  input: BuildCorrelationLinksInput,
): CorrelationTrustLink[] {
  const jobSignals = healthSignalsForJob(input.health.signals, input.job_id);

  const raw: CorrelationTrustLink[] = [
    ...buildTimelineHealthLinks({
      job_id:         input.job_id,
      events:         input.timeline_events,
      health_signals: jobSignals,
    }),
    ...buildHaltMutationLinks({
      job_id:   input.job_id,
      timeline: input.timeline,
    }),
    ...buildRetryQueuePressureLinks({
      job_id:            input.job_id,
      health_signals:    jobSignals,
      decision_history:  input.decision_history,
    }),
    ...buildDecisionFailureLinks({
      job_id:            input.job_id,
      decision_history:  input.decision_history,
      worker_result:     input.worker_result,
    }),
    ...buildLineageEvidenceLinks({
      job_id:            input.job_id,
      events:            input.timeline_events,
      decision_history:  input.decision_history,
    }),
  ];

  const seen = new Set<string>();
  const deduped = raw.filter((link) => {
    const key = `${link.kind}|${link.left_ref}|${link.right_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return (
      link.left_ref.length > 0 &&
      link.right_ref.length > 0
    );
  });

  return sortCorrelationLinks(deduped);
}

export function buildCorrelatedExecutionTrustProjection(input: {
  readonly worker_result: WorkerResultRecord;
  readonly timeline_trust_projection: TimelineTrustSurfaceProjection;
  readonly health: WorkflowHealthProjection;
  readonly decision_history: DecisionHistoryProjection;
  readonly link_count: number;
  readonly correlation_status: CorrelationTrustStatus;
  readonly now?: Date;
}): CorrelatedExecutionTrustProjection {
  const now = input.now ?? new Date();
  const job_id = input.worker_result.job_id;
  return {
    correlation_id:              `corr-${job_id.slice(0, 12)}-${now.getTime()}`,
    execution_id:                job_id,
    timeline_trust_reference:    input.timeline_trust_projection.trust_timeline_id,
    health_projection_reference: input.health.projection_id,
    decision_history_reference:  input.decision_history.history_id,
    correlation_count:           input.link_count,
    correlation_status:          input.correlation_status,
    created_at:                  now.toISOString(),
  };
}
