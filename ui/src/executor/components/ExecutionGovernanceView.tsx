import { Link } from "react-router-dom";
import type {
  ExecutionGovernanceSurface,
  GovernanceTrustBundle,
} from "../types.js";
import { GovernanceSignalCard } from "./GovernanceSignalCard.js";

type Props = {
  readonly bundle: GovernanceTrustBundle;
};

const STATUS_LABEL: Record<
  GovernanceTrustBundle["projection"]["governance_status"],
  string
> = {
  available:   "Available",
  partial:     "Partial",
  unavailable: "Unavailable",
};

const SURFACE_TITLES: Record<ExecutionGovernanceSurface, string> = {
  invariant_pressure_zones:           "Invariant pressure zones",
  boundary_proximity_indicators:      "Boundary proximity indicators",
  replay_authority_separation_checks: "Replay / authority separation checks",
  cross_surface_doctrine_consistency:   "Cross-surface doctrine consistency",
  governance_drift_references:        "Governance drift references",
  governance_lineage_references:      "Governance lineage references",
};

export function ExecutionGovernanceView({ bundle }: Props) {
  const { projection, indicators, surfaces } = bundle;
  const anchorId = projection.anchor_job_id;

  return (
    <div aria-label="Execution governance surface">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">Execution governance</h2>
        <p className="mt-2 text-xs text-gray-500">
          Governance surfaces describe execution trust boundaries; they never enforce
          execution trust boundaries.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Status: {STATUS_LABEL[projection.governance_status]} ·{" "}
          {projection.indicator_count} indicator(s) · window{" "}
          {projection.evidence_window_start} → {projection.evidence_window_end}
        </p>
        {bundle.unavailable_reason !== undefined && (
          <p className="mt-2 text-xs text-amber-200/90">{bundle.unavailable_reason}</p>
        )}
        <nav className="mt-3 flex flex-wrap gap-3 text-xs" aria-label="Read-only deep links">
          <Link
            to="/dashboard/executions/diagnostics"
            className="text-cyan-400/80 hover:text-cyan-300"
          >
            Diagnostics →
          </Link>
          <Link
            to="/dashboard/executions/health"
            className="text-cyan-400/80 hover:text-cyan-300"
          >
            Fleet health →
          </Link>
          {anchorId !== undefined && (
            <>
              <Link
                to={`/dashboard/executions/${encodeURIComponent(anchorId)}/correlation`}
                className="text-cyan-400/80 hover:text-cyan-300"
              >
                Anchor correlation →
              </Link>
              <Link
                to={`/dashboard/executions/${encodeURIComponent(anchorId)}/inspect`}
                className="text-cyan-400/80 hover:text-cyan-300"
              >
                Anchor inspect →
              </Link>
              <Link
                to={`/dashboard/executions/${encodeURIComponent(anchorId)}/timeline`}
                className="text-cyan-400/80 hover:text-cyan-300"
              >
                Anchor timeline →
              </Link>
            </>
          )}
        </nav>
      </header>

      <div className="space-y-6">
        {surfaces.map((surface) => {
          const sectionIndicators = indicators.filter((i) => i.surface === surface);
          return (
            <section key={surface} aria-labelledby={`gov-surface-${surface}`}>
              <h3
                id={`gov-surface-${surface}`}
                className="text-sm font-semibold text-gray-200 mb-2"
              >
                {SURFACE_TITLES[surface]}
              </h3>
              {sectionIndicators.length === 0 ? (
                <p className="text-xs text-gray-600">No indicators for this surface.</p>
              ) : (
                <ul className="list-none m-0 p-0 space-y-2">
                  {sectionIndicators.map((indicator) => (
                    <GovernanceSignalCard
                      key={indicator.indicator_id}
                      indicator={indicator}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="mt-8 text-[10px] text-gray-600 font-mono">
        diagnostics: {projection.diagnostics_reference}
        {projection.correlation_reference !== undefined && (
          <> · correlation: {projection.correlation_reference}</>
        )}
        {projection.replay_inspection_reference !== undefined && (
          <> · inspect: {projection.replay_inspection_reference}</>
        )}
      </footer>
    </div>
  );
}
