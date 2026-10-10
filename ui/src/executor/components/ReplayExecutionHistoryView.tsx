import { Link } from "react-router-dom";

import type { ReplayExecutionAuditEntry } from "../types.js";
import { REPLAY_EXECUTION_HISTORY_BANNER } from "../types.js";

type Props = {
  readonly job_id: string;
  readonly entries: readonly ReplayExecutionAuditEntry[];
};

const STATE_LABEL: Record<ReplayExecutionAuditEntry["replay_execution_state"], string> = {
  executed: "Executed (record only)",
  blocked:  "Blocked (record only)",
  expired:  "Expired (record only)",
};

export function ReplayExecutionHistoryView({ job_id, entries }: Props) {
  const sandboxHref = `/dashboard/executions/${encodeURIComponent(job_id)}/replay-sandbox`;

  return (
    <section aria-label="Replay execution history">
      <div
        role="status"
        className="rounded-lg border border-cyan-900/50 bg-cyan-950/30 p-4 text-sm text-cyan-100 mb-6"
      >
        <p className="font-medium">{REPLAY_EXECUTION_HISTORY_BANNER}</p>
        <p className="mt-2 text-xs text-cyan-200/80">
          Descriptive audit only — no worker dispatch and no production state change.
        </p>
      </div>

      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">Replay execution history</h2>
        <p className="text-xs font-mono text-gray-500 mt-1">{job_id}</p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">
          No record-only replay execution attempts have been stored for this job yet.
        </p>
      ) : (
        <ol className="list-none m-0 p-0 space-y-4">
          {entries.map((entry) => (
            <li
              key={entry.audit_entry_id}
              className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4 text-sm"
            >
              <p className="font-medium text-gray-200">
                {STATE_LABEL[entry.replay_execution_state]}
              </p>
              <dl className="mt-3 grid gap-2 text-xs text-gray-400">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-600">
                    Recorded at
                  </dt>
                  <dd className="font-mono text-gray-300">{entry.recorded_at}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-600">
                    Operator
                  </dt>
                  <dd className="font-mono text-gray-300">{entry.operator_id}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-600">
                    Replay execution ID
                  </dt>
                  <dd className="font-mono break-all text-gray-300">
                    {entry.replay_execution_id}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-600">Reason</dt>
                  <dd className="text-gray-300">{entry.replay_execution_reason}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 text-xs text-gray-500">
        <Link to={sandboxHref} className="text-cyan-400/80 hover:text-cyan-300 underline">
          Replay sandbox →
        </Link>
        {" · read-only operator trace"}
      </p>
    </section>
  );
}
