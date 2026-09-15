import { useParams } from "react-router-dom";
import { DecisionHistoryView } from "../executor/components/DecisionHistoryView.js";
import { useDecisionHistory } from "../executor/useDecisionHistory.js";
import { DECISION_HISTORY_BANNER } from "../executor/types.js";

/**
 * Per-execution decision history (Sprint #29).
 */
export function DecisionHistoryPage() {
  const { job_id } = useParams<{ job_id: string }>();
  const { state, reload } = useDecisionHistory(job_id);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8">
      <p className="sr-only">{DECISION_HISTORY_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Decision history</h1>
        <p className="mt-2 text-sm text-gray-400">
          Complete decision chain from authoritative records — descriptive only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading decision history…
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

      {state.status === "ready" && <DecisionHistoryView history={state.history} />}

      {state.status === "idle" && (
        <p className="text-sm text-gray-500">Preparing decision history…</p>
      )}
    </div>
  );
}
