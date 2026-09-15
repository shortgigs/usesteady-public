import { useSearchParams } from "react-router-dom";
import { ExecutionDiagnosticsView } from "../executor/components/ExecutionDiagnosticsView.js";
import { useExecutionDiagnostics } from "../executor/useExecutionDiagnostics.js";
import { EXECUTION_DIAGNOSTICS_SURFACE_BANNER } from "../executor/types.js";

/**
 * Fleet execution diagnostics surface (Sprint #34b).
 */
export function ExecutionDiagnosticsPage() {
  const [searchParams] = useSearchParams();
  const anchor_job_id = searchParams.get("anchor_job_id") ?? undefined;
  const { state, reload } = useExecutionDiagnostics(24, anchor_job_id);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <p className="sr-only">{EXECUTION_DIAGNOSTICS_SURFACE_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Execution diagnostics</h1>
        <p className="mt-2 text-sm text-gray-400">
          Recurring degradation patterns from certified projections — descriptive only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading execution diagnostics…
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
        <ExecutionDiagnosticsView bundle={state.diagnostics} />
      )}
    </div>
  );
}
