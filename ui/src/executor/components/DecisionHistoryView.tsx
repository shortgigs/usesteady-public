import { Link } from "react-router-dom";
import type { DecisionHistoryProjection } from "../types.js";
import { DecisionStageRow } from "./DecisionStageRow.js";

type Props = {
  readonly history: DecisionHistoryProjection;
};

export function DecisionHistoryView({ history }: Props) {
  return (
    <section aria-label="Decision history">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">{history.request_label}</h2>
        <p className="text-xs font-mono text-gray-500 mt-1">{history.job_id}</p>
      </header>

      {history.entries.length === 0 ? (
        <p className="text-sm text-gray-500">
          No decision chain evidence for this execution.
        </p>
      ) : (
        <ol className="list-none m-0 p-0">
          {history.entries.map((entry, i) => (
            <DecisionStageRow
              key={`${entry.stage}-${entry.lineage_reference}`}
              entry={entry}
              isLast={i === history.entries.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
