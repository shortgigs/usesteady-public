import { useParams } from "react-router-dom";
import { CorrelatedTrustView } from "../executor/components/CorrelatedTrustView.js";
import { useCorrelatedTrust } from "../executor/useCorrelatedTrust.js";
import { CORRELATED_TRUST_SURFACE_BANNER } from "../executor/types.js";

/**
 * Per-execution correlated trust surface (Sprint #33b).
 */
export function CorrelatedTrustPage() {
  const { job_id } = useParams<{ job_id: string }>();
  const { state, reload } = useCorrelatedTrust(job_id);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <p className="sr-only">{CORRELATED_TRUST_SURFACE_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Correlated trust</h1>
        <p className="mt-2 text-sm text-gray-400">
          Relationships between timeline, health, and decision signals — observation only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading correlated trust surface…
        </p>
      )}

      {state.status === "error" && (
        <div className="rounded border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-100">
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
        <CorrelatedTrustView view={state.correlation_trust} />
      )}
    </div>
  );
}
