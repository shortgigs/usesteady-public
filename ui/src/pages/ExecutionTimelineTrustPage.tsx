import { useParams } from "react-router-dom";
import { TimelineTrustSurfaceView } from "../executor/components/TimelineTrustSurfaceView.js";
import { useTimelineTrustSurface } from "../executor/useTimelineTrustSurface.js";
import { TIMELINE_TRUST_SURFACE_BANNER } from "../executor/types.js";

/**
 * Per-execution timeline trust surface (Sprint #32b).
 */
export function ExecutionTimelineTrustPage() {
  const { job_id } = useParams<{ job_id: string }>();
  const { state, reload } = useTimelineTrustSurface(job_id);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <p className="sr-only">{TIMELINE_TRUST_SURFACE_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Execution timeline</h1>
        <p className="mt-2 text-sm text-gray-400">
          Ordered execution history from authoritative records — observation only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading timeline trust surface…
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

      {state.status === "ready" && (
        <TimelineTrustSurfaceView view={state.timeline_trust} />
      )}

      {state.status === "idle" && (
        <p className="text-sm text-gray-500">Preparing timeline trust surface…</p>
      )}
    </div>
  );
}
