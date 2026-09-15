import { Link } from "react-router-dom";
import type {
  HealthSignalType,
  WorkflowHealthProjection,
  WorkflowHealthSignal,
} from "../types.js";
import { WorkflowHealthSignalCard } from "./WorkflowHealthSignalCard.js";

type Props = {
  readonly health: WorkflowHealthProjection;
};

const PANEL_ORDER: readonly HealthSignalType[] = [
  "stalled_chain_detected",
  "retry_spike_detected",
  "pending_duration_exceeded",
  "failure_rate_elevated",
  "queue_pressure_detected",
];

const PANEL_HEADINGS: Record<HealthSignalType, string> = {
  stalled_chain_detected:    "Stalled chains",
  retry_spike_detected:      "Retry spikes",
  pending_duration_exceeded: "Pending duration",
  failure_rate_elevated:     "Failure trends",
  queue_pressure_detected:   "Queue pressure",
};

export function WorkflowHealthView({ health }: Props) {
  if (health.unavailable === true) {
    return (
      <p className="text-sm text-amber-200/90">
        {health.unavailable_reason ?? "Workflow health unavailable."}
      </p>
    );
  }

  const byType = new Map<HealthSignalType, WorkflowHealthSignal[]>();
  for (const signal of health.signals) {
    const list = byType.get(signal.signal_type) ?? [];
    list.push(signal);
    byType.set(signal.signal_type, list);
  }

  return (
    <section aria-label="Workflow health">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <p className="text-xs text-gray-500 font-mono">
          Generated {health.generated_at}
        </p>
      </header>

      {health.signals.length === 0 ? (
        <p className="text-sm text-gray-500">
          No bottleneck signals in the current evidence window. Observation only —
          thresholds are deterministic; nothing here runs or remediates.
        </p>
      ) : (
        <div className="space-y-8">
          {PANEL_ORDER.map((type) => {
            const panelSignals = byType.get(type);
            if (panelSignals === undefined || panelSignals.length === 0) {
              return (
                <div key={type}>
                  <h2 className="text-sm font-medium text-gray-500 mb-2">
                    {PANEL_HEADINGS[type]}
                  </h2>
                  <p className="text-xs text-gray-600">No signal in this window.</p>
                </div>
              );
            }
            return (
              <div key={type}>
                <h2 className="text-sm font-medium text-gray-200 mb-3">
                  {PANEL_HEADINGS[type]}
                </h2>
                <ul className="list-none m-0 p-0 space-y-3">
                  {panelSignals.map((signal) => (
                    <li key={signal.health_signal_id}>
                      <WorkflowHealthSignalCard signal={signal} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
