import { Link } from "react-router-dom";
import { RecentExecutionsView } from "../executor/components/RecentExecutionsView.js";
import { useRecentExecutions } from "../executor/useRecentExecutions.js";
import { RECENT_EXECUTIONS_BANNER } from "../executor/types.js";
import { LoadingState } from "../components/ui/LoadingState.js";
import { ErrorState }   from "../components/ui/ErrorState.js";

/**
 * Operator trust surface — execution timeline list (Sprint #28).
 * @see docs/product/executor-execution-timeline-surface-contract-v1.md
 */
export function ExecutionsDashboardPage() {
  const { state, reload } = useRecentExecutions(50);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <p className="sr-only">{RECENT_EXECUTIONS_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Executions</h1>
        <p className="mt-2 text-sm text-gray-400 max-w-xl">
          Controlled, verified activity from stored worker results. Observation only —
          nothing here runs or approves steps.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            to="/dashboard/executions/health"
            className="inline-flex text-xs text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 items-center"
          >
            Workflow health →
          </Link>
          <Link
            to="/dashboard/executions/diagnostics"
            className="inline-flex text-xs text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 items-center"
          >
            Execution diagnostics →
          </Link>
          <Link
            to="/dashboard/executions/governance"
            className="inline-flex text-xs text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 items-center"
          >
            Execution governance →
          </Link>
        </div>
      </header>

      {state.status === "loading" && (
        <LoadingState
          label="Loading recent executions…"
          className="flex items-center gap-3 text-gray-400 text-sm py-4"
        />
      )}

      {state.status === "error" && (
        <ErrorState
          message={state.envelope.explain}
          onRetry={() => void reload()}
        />
      )}

      {state.status === "ready" && <RecentExecutionsView recent={state.recent} />}

      {state.status === "idle" && (
        <LoadingState
          label="Preparing recent executions view…"
          className="flex items-center gap-3 text-gray-400 text-sm py-4"
        />
      )}
    </div>
  );
}
