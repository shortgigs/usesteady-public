import { useState } from "react";
import { Link } from "react-router-dom";
import type { ReplayInspectionBundle } from "../types.js";
import { ReplayInspectionSection } from "./ReplayInspectionSection.js";

type Props = {
  readonly inspect: ReplayInspectionBundle;
};

const STATUS_LABEL: Record<
  ReplayInspectionBundle["projection"]["inspectability_status"],
  string
> = {
  available:   "Available",
  partial:     "Partial",
  unavailable: "Unavailable",
};

export function ReplayInspectionView({ inspect }: Props) {
  const [exportCopied, setExportCopied] = useState(false);
  const { projection, payload } = inspect;

  const handleExportCopy = async () => {
    const json = JSON.stringify(inspect, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch {
      setExportCopied(false);
    }
  };

  return (
    <div aria-label="Replay inspection">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">
          Inspect lineage — {projection.execution_id}
        </h2>
        <p className="mt-2 text-xs text-gray-500">
          Inspect only — lineage reconstruction, no re-execution.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Status: {STATUS_LABEL[projection.inspectability_status]} ·{" "}
          <span className="font-mono">{projection.inspect_bundle_reference}</span>
        </p>
        {inspect.unavailable_reason !== undefined && (
          <p className="mt-2 text-xs text-amber-200/90">{inspect.unavailable_reason}</p>
        )}
      </header>

      <div className="space-y-4">
        <ReplayInspectionSection title="Execution lineage">
          <ul className="list-none m-0 p-0 space-y-1 text-xs font-mono text-gray-400">
            {payload.execution_lineage_refs.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        </ReplayInspectionSection>

        <ReplayInspectionSection title="Trace references">
          <dl className="text-xs text-gray-400 space-y-1">
            <div>
              <dt className="text-gray-600 inline">Trace: </dt>
              <dd className="inline font-mono">{projection.trace_reference}</dd>
            </div>
            {payload.trace.source_record_refs.map((ref) => (
              <div key={ref}>
                <dd className="font-mono">{ref}</dd>
              </div>
            ))}
          </dl>
        </ReplayInspectionSection>

        <ReplayInspectionSection title="Decision chain">
          <p className="text-xs text-gray-500 mb-2 font-mono">
            {projection.decision_history_reference}
          </p>
          {payload.decision_history.entries.length === 0 ? (
            <p className="text-xs text-gray-500">No decision chain entries.</p>
          ) : (
            <ul className="list-none m-0 p-0 space-y-2">
              {payload.decision_history.entries.map((entry) => (
                <li key={entry.lineage_reference} className="text-xs text-gray-300">
                  <span className="text-cyan-200/80">{entry.stage}</span>
                  {" · "}
                  {entry.decision}
                  {" · "}
                  <span className="font-mono text-gray-500">{entry.lineage_reference}</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to={`/dashboard/executions/${encodeURIComponent(projection.execution_id)}/history`}
            className="mt-2 inline-flex text-xs text-cyan-400 hover:text-cyan-300 underline min-h-11 items-center"
          >
            Open decision history →
          </Link>
        </ReplayInspectionSection>

        <ReplayInspectionSection title="Timeline references">
          <p className="text-xs font-mono text-gray-500 mb-2">
            {projection.timeline_reference}
          </p>
          {payload.timeline === undefined ? (
            <p className="text-xs text-gray-500">Timeline projection unavailable.</p>
          ) : (
            <ul className="list-none m-0 p-0 space-y-1 text-xs text-gray-400">
              {payload.timeline.entries.map((entry) => (
                <li key={entry.record_ref}>
                  <span className="text-gray-300">{entry.kind}</span>
                  {" · "}
                  <span className="font-mono">{entry.record_ref}</span>
                  {" · "}
                  <time dateTime={entry.at}>{entry.at}</time>
                </li>
              ))}
            </ul>
          )}
        </ReplayInspectionSection>

        <ReplayInspectionSection title="Deterministic replay metadata">
          <dl className="text-xs text-gray-400 space-y-1">
            <div>
              <dt className="text-gray-600">Replay reference: </dt>
              <dd className="font-mono break-all">{projection.replay_reference}</dd>
            </div>
            <div>
              <dt className="text-gray-600">Lineage hash: </dt>
              <dd className="font-mono break-all">{projection.lineage_hash}</dd>
            </div>
            {payload.explain !== undefined && (
              <>
                <div>
                  <dt className="text-gray-600">Replay lineage refs: </dt>
                  <dd className="font-mono">
                    {payload.explain.replay_lineage_ref.join(" | ")}
                  </dd>
                </div>
                {payload.explain.descriptive_replay === true && (
                  <div>
                    <dd className="text-gray-500">descriptive_replay: true</dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </ReplayInspectionSection>

        <ReplayInspectionSection title="Projection bundle export">
          <p className="text-xs text-gray-500 mb-3">
            Copy deterministic bundle JSON for audit — export only, not execution.
          </p>
          <button
            type="button"
            onClick={() => void handleExportCopy()}
            className="text-xs px-3 py-2 rounded border border-cyan-700/50 text-cyan-300 hover:bg-cyan-950/40 min-h-11"
          >
            {exportCopied ? "Copied to clipboard" : "Copy bundle JSON"}
          </button>
        </ReplayInspectionSection>
      </div>
    </div>
  );
}
