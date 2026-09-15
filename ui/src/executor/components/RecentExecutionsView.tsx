import type { RecentExecutionsProjection } from "../types.js";
import { ExecutionSummaryRow } from "./ExecutionSummaryRow.js";

type Props = {
  readonly recent: RecentExecutionsProjection;
};

export function RecentExecutionsView({ recent }: Props) {
  return (
    <section aria-label="Recent executions">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-100">Recent executions</h2>
        {recent.truncated && (
          <span className="text-xs text-gray-500">
            Showing newest {recent.limit} — more evidence stored
          </span>
        )}
      </header>

      {recent.items.length === 0 ? (
        <p className="text-sm text-gray-500 rounded-lg border border-dashed border-gray-800 p-6">
          No execution evidence yet. Complete a UI chain intake from Preview to populate
          this list.
        </p>
      ) : (
        <ul className="space-y-3">
          {recent.items.map((summary) => (
            <ExecutionSummaryRow key={summary.job_id} summary={summary} />
          ))}
        </ul>
      )}
    </section>
  );
}
