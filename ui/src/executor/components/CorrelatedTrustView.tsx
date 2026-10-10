import { Link } from "react-router-dom";
import type { CorrelatedTrustSurface, CorrelatedTrustSurfaceView } from "../types.js";
import { CorrelationSignalCard } from "./CorrelationSignalCard.js";

type Props = {
  readonly view: CorrelatedTrustSurfaceView;
};

const STATUS_LABEL: Record<
  CorrelatedTrustSurfaceView["projection"]["correlation_status"],
  string
> = {
  available:   "Available",
  partial:     "Partial",
  unavailable: "Unavailable",
};

const SURFACE_TITLES: Record<CorrelatedTrustSurface, string> = {
  timeline_health_correlation:      "Timeline ↔ Health correlation",
  halt_mutation_correlation:        "Halt ↔ Mutation correlation",
  retry_queue_pressure_correlation: "Retry ↔ Queue-pressure correlation",
  decision_failure_correlation:     "Decision ↔ Failure correlation",
  lineage_linked_evidence:          "Lineage-linked evidence references",
};

const KIND_FOR_SURFACE: Record<
  CorrelatedTrustSurface,
  CorrelatedTrustSurfaceView["links"][number]["kind"]
> = {
  timeline_health_correlation:      "timeline_health",
  halt_mutation_correlation:        "halt_mutation",
  retry_queue_pressure_correlation: "retry_queue_pressure",
  decision_failure_correlation:     "decision_failure",
  lineage_linked_evidence:          "lineage_evidence",
};

export function CorrelatedTrustView({ view }: Props) {
  const { projection, links, surfaces } = view;
  const jobId = projection.execution_id;
  const timelineHref = `/dashboard/executions/${encodeURIComponent(jobId)}/timeline`;
  const historyHref = `/dashboard/executions/${encodeURIComponent(jobId)}/history`;
  const healthHref = "/dashboard/executions/health";
  const inspectHref = `/dashboard/executions/${encodeURIComponent(jobId)}/inspect`;

  return (
    <div aria-label="Correlated trust surface">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">
          Correlated trust — {projection.execution_id}
        </h2>
        <p className="mt-2 text-xs text-gray-500">
          Descriptive correlation only — observation does not prescribe action.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Status: {STATUS_LABEL[projection.correlation_status]} ·{" "}
          {projection.correlation_count} link(s) ·{" "}
          <span className="font-mono">{projection.correlation_id}</span>
        </p>
        {view.unavailable_reason !== undefined && (
          <p className="mt-2 text-xs text-amber-200/90">{view.unavailable_reason}</p>
        )}
        <nav className="mt-3 flex flex-wrap gap-3 text-xs" aria-label="Read-only deep links">
          <Link to={timelineHref} className="text-cyan-400/80 hover:text-cyan-300">
            Timeline →
          </Link>
          <Link to={historyHref} className="text-cyan-400/80 hover:text-cyan-300">
            Decision history →
          </Link>
          <Link to={healthHref} className="text-cyan-400/80 hover:text-cyan-300">
            Fleet health →
          </Link>
          <Link to={inspectHref} className="text-cyan-400/80 hover:text-cyan-300">
            Inspect lineage →
          </Link>
        </nav>
      </header>

      <div className="space-y-6">
        {surfaces.map((surface) => {
          const kind = KIND_FOR_SURFACE[surface];
          const sectionLinks = links.filter((l) => l.kind === kind);
          return (
            <section
              key={surface}
              aria-labelledby={`corr-surface-${surface}`}
            >
              <h3
                id={`corr-surface-${surface}`}
                className="text-sm font-semibold text-gray-200 mb-2"
              >
                {SURFACE_TITLES[surface]}
              </h3>
              {sectionLinks.length === 0 ? (
                <p className="text-xs text-gray-600">No links for this surface.</p>
              ) : (
                <ul className="list-none m-0 p-0 space-y-2">
                  {sectionLinks.map((link) => (
                    <CorrelationSignalCard
                      key={link.correlation_link_id}
                      link={link}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="mt-8 text-[10px] text-gray-600 font-mono">
        timeline: {projection.timeline_trust_reference} · health:{" "}
        {projection.health_projection_reference} · history:{" "}
        {projection.decision_history_reference}
      </footer>
    </div>
  );
}
