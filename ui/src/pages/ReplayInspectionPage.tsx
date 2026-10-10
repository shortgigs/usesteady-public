import { useParams } from "react-router-dom";
import { ReplayInspectionView } from "../executor/components/ReplayInspectionView.js";
import { useReplayInspection } from "../executor/useReplayInspection.js";
import { REPLAY_INSPECTION_BANNER } from "../executor/types.js";

/**
 * Per-execution replay / inspect (Sprint #31).
 */
export function ReplayInspectionPage() {
  const { job_id } = useParams<{ job_id: string }>();
  const { state, reload } = useReplayInspection(job_id);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <p className="sr-only">{REPLAY_INSPECTION_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Replay / Inspect</h1>
        <p className="mt-2 text-sm text-gray-400">
          Reconstruct execution lineage from authoritative records — inspect only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading replay inspection…
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

      {state.status === "ready" && <ReplayInspectionView inspect={state.inspect} />}

      {state.status === "idle" && (
        <p className="text-sm text-gray-500">Preparing replay inspection…</p>
      )}
    </div>
  );
}
