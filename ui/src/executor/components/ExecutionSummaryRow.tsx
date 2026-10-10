import { Link } from "react-router-dom";
import type { ExecutionSummaryProjection } from "../types.js";

type Props = {
  readonly summary: ExecutionSummaryProjection;
};

const STATUS_LABELS: Record<ExecutionSummaryProjection["status"], string> = {
  completed:   "Completed",
  denied:      "Denied",
  halted:      "Halted",
  unavailable: "Unavailable",
};

function statusClass(status: ExecutionSummaryProjection["status"]): string {
  switch (status) {
    case "completed":
      return "text-emerald-400";
    case "denied":
      return "text-amber-400";
    default:
      return "text-gray-400";
  }
}

function shortId(job_id: string): string {
  const tail = job_id.replace(/^job-/, "").slice(-4);
  return tail.length > 0 ? tail : job_id.slice(0, 8);
}

export function ExecutionSummaryRow({ summary }: Props) {
  const explainHref = `/apply-fix?job_id=${encodeURIComponent(summary.job_id)}`;
  const historyHref = `/dashboard/executions/${encodeURIComponent(summary.job_id)}/history`;
  const lineageInspectHref = `/dashboard/executions/${encodeURIComponent(summary.job_id)}/inspect`;
  const replaySandboxHref = `/dashboard/executions/${encodeURIComponent(summary.job_id)}/replay-sandbox`;
  const replayExecutionHistoryHref = `/dashboard/executions/${encodeURIComponent(summary.job_id)}/replay-execution-history`;
  const timelineTrustHref = `/dashboard/executions/${encodeURIComponent(summary.job_id)}/timeline`;
  const correlationTrustHref = `/dashboard/executions/${encodeURIComponent(summary.job_id)}/correlation`;
  const diagnosticsHref = `/dashboard/executions/diagnostics?anchor_job_id=${encodeURIComponent(summary.job_id)}`;
  const governanceHref = `/dashboard/executions/governance?anchor_job_id=${encodeURIComponent(summary.job_id)}`;

  return (
    <li className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-gray-500">#{shortId(summary.job_id)}</p>
          <h3 className="text-sm font-medium text-gray-100 truncate">{summary.title}</h3>
        </div>
        <span className={`text-sm font-semibold ${statusClass(summary.status)}`}>
          {STATUS_LABELS[summary.status]}
          {summary.status === "completed" && (
            <span className="ml-1 text-emerald-500" aria-hidden="true">
              ✓
            </span>
          )}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-gray-400">
        <div>
          <dt className="uppercase tracking-wide text-[10px] text-gray-600">Owner</dt>
          <dd className="text-gray-300">{summary.owner}</dd>
        </div>
        {summary.duration_display !== undefined && (
          <div>
            <dt className="uppercase tracking-wide text-[10px] text-gray-600">Duration</dt>
            <dd className="text-gray-300">{summary.duration_display}</dd>
          </div>
        )}
        {summary.authority_reference !== undefined && (
          <div>
            <dt className="uppercase tracking-wide text-[10px] text-gray-600">Authority</dt>
            <dd className="text-gray-300 font-mono">{summary.authority_reference}</dd>
          </div>
        )}
        <div>
          <dt className="uppercase tracking-wide text-[10px] text-gray-600">Recorded</dt>
          <dd className="text-gray-300 font-mono">{summary.created_at}</dd>
        </div>
      </dl>

      {summary.rejection_cause !== undefined && (
        <p className="mt-2 text-xs text-amber-200/90">
          Reason: {summary.rejection_cause}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {summary.replay_available && (
          <Link
            to={explainHref}
            className="text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
          >
            Replay available →
          </Link>
        )}
        <Link
          to={explainHref}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Explain →
        </Link>
        <Link
          to={historyHref}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Decision history →
        </Link>
        <Link
          to={timelineTrustHref}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Trust timeline →
        </Link>
        <Link
          to={correlationTrustHref}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Correlation →
        </Link>
        <Link
          to={diagnosticsHref}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Diagnostics →
        </Link>
        <Link
          to={governanceHref}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Governance →
        </Link>
        {summary.replay_available && (
          <Link
            to={lineageInspectHref}
            className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
          >
            Inspect lineage →
          </Link>
        )}
        {summary.replay_available && (
          <Link
            to={replaySandboxHref}
            className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
          >
            Replay sandbox →
          </Link>
        )}
        {summary.replay_available && (
          <Link
            to={replayExecutionHistoryHref}
            className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
          >
            Replay execution history →
          </Link>
        )}
      </div>
    </li>
  );
}
