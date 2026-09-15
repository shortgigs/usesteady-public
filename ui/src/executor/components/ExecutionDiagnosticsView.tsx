import { Link } from "react-router-dom";
import type {
  ExecutionDiagnosticsBundle,
  ExecutionDiagnosticsSurface,
} from "../types.js";
import { DiagnosticSignalCard } from "./DiagnosticSignalCard.js";

type Props = {
  readonly bundle: ExecutionDiagnosticsBundle;
};

const STATUS_LABEL: Record<
  ExecutionDiagnosticsBundle["projection"]["diagnostics_status"],
  string
> = {
  available:   "Available",
  partial:     "Partial",
  unavailable: "Unavailable",
};

const SURFACE_TITLES: Record<ExecutionDiagnosticsSurface, string> = {
  repeated_halt_clustering:      "Repeated halt clustering",
  retry_concentration_windows:   "Retry concentration windows",
  queue_pressure_hotspots:       "Queue-pressure hotspots",
  mutation_instability_zones:    "Mutation instability zones",
  decision_refusal_density:      "Decision refusal density",
  diagnostic_lineage_references: "Diagnostic lineage references",
};

export function ExecutionDiagnosticsView({ bundle }: Props) {
  const { projection, findings, surfaces } = bundle;
  const anchorId = projection.anchor_job_id;

  return (
    <div aria-label="Execution diagnostics surface">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">Execution diagnostics</h2>
        <p className="mt-2 text-xs text-gray-500">
          Recurring conditions from authoritative evidence — observation does not modify execution.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Status: {STATUS_LABEL[projection.diagnostics_status]} · {projection.finding_count}{" "}
          finding(s) · window {projection.evidence_window_start} →{" "}
          {projection.evidence_window_end}
        </p>
        {bundle.unavailable_reason !== undefined && (
          <p className="mt-2 text-xs text-amber-200/90">{bundle.unavailable_reason}</p>
        )}
        <nav className="mt-3 flex flex-wrap gap-3 text-xs" aria-label="Read-only deep links">
          <Link to="/dashboard/executions/health" className="text-cyan-400/80 hover:text-cyan-300">
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
          const sectionFindings = findings.filter((f) => f.surface === surface);
          return (
            <section key={surface} aria-labelledby={`diag-surface-${surface}`}>
              <h3
                id={`diag-surface-${surface}`}
                className="text-sm font-semibold text-gray-200 mb-2"
              >
                {SURFACE_TITLES[surface]}
              </h3>
              {sectionFindings.length === 0 ? (
                <p className="text-xs text-gray-600">No findings for this surface.</p>
              ) : (
                <ul className="list-none m-0 p-0 space-y-2">
                  {sectionFindings.map((finding) => (
                    <DiagnosticSignalCard
                      key={finding.finding_id}
                      finding={finding}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="mt-8 text-[10px] text-gray-600 font-mono">
        health: {projection.health_projection_reference}
        {projection.correlation_reference !== undefined && (
          <> · correlation: {projection.correlation_reference}</>
        )}
        {projection.timeline_trust_reference !== undefined && (
          <> · timeline: {projection.timeline_trust_reference}</>
        )}
      </footer>
    </div>
  );
}
