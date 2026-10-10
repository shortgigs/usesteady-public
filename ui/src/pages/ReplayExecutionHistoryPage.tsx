import { useParams } from "react-router-dom";

import { ReplayExecutionHistoryView } from "../executor/components/ReplayExecutionHistoryView.js";
import { useReplayExecutionHistory } from "../executor/useReplayExecutionHistory.js";

/**
 * Per-job PREX audit history (read-only).
 */
export function ReplayExecutionHistoryPage() {
  const { job_id } = useParams<{ job_id: string }>();
  const { state, reload } = useReplayExecutionHistory(job_id);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Replay execution audit</h1>
        <p className="mt-2 text-sm text-gray-400">
          Append-only record-only replay attempts — descriptive visibility only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading replay execution history…
        </p>
      )}

      {state.status === "error" && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-200">
          <p>{state.envelope.explain}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-3 text-xs text-cyan-400 hover:text-cyan-300 underline"
          >
            Retry load
          </button>
        </div>
      )}

      {state.status === "ready" && job_id !== undefined && (
        <ReplayExecutionHistoryView job_id={job_id} entries={state.entries} />
      )}

      {state.status === "idle" && (
        <p className="text-sm text-gray-500">Preparing replay execution history…</p>
      )}
    </div>
  );
}
