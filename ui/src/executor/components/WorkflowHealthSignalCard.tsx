import type { WorkflowHealthSignal } from "../types.js";

type Props = {
  readonly signal: WorkflowHealthSignal;
};

const PANEL_LABELS: Record<WorkflowHealthSignal["signal_type"], string> = {
  stalled_chain_detected:    "Stalled chains",
  retry_spike_detected:      "Retry spikes",
  pending_duration_exceeded: "Pending duration",
  failure_rate_elevated:     "Failure trends",
  queue_pressure_detected:   "Queue pressure",
};

const SEVERITY_CLASS: Record<WorkflowHealthSignal["severity"], string> = {
  low:    "text-gray-400 border-gray-700",
  medium: "text-amber-300/90 border-amber-900/50",
  high:   "text-red-300/90 border-red-900/50",
};

export function WorkflowHealthSignalCard({ signal }: Props) {
  return (
    <article
      className={`rounded-lg border bg-gray-900/40 p-4 ${SEVERITY_CLASS[signal.severity]}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-100">
          {PANEL_LABELS[signal.signal_type]}
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-gray-500">
          {signal.severity} severity
        </span>
      </header>
      <p className="mt-2 text-sm text-gray-300">{signal.observed_value}</p>
      <dl className="mt-3 space-y-1 text-xs text-gray-500">
        <div>
          <dt className="inline text-gray-600">Affected: </dt>
          <dd className="inline text-gray-400">{signal.affected_execution_count}</dd>
        </div>
        <div>
          <dt className="inline text-gray-600">Threshold: </dt>
          <dd className="inline font-mono text-gray-400">{signal.threshold_reference}</dd>
        </div>
        <div>
          <dt className="inline text-gray-600">Observed: </dt>
          <dd className="inline">
            <time dateTime={signal.observed_at}>{signal.observed_at}</time>
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[10px] font-mono text-gray-600 break-all">
        {signal.lineage_reference}
      </p>
      {signal.explainability_reference !== undefined && (
        <p className="mt-1 text-[10px] text-gray-500">
          Explain path: {signal.explainability_reference} (navigation only)
        </p>
      )}
      <p className="mt-2 text-[10px] text-gray-500 italic">
        Descriptive only — no recommended action.
      </p>
    </article>
  );
}
