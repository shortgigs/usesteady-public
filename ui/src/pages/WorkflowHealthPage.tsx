import { WorkflowHealthView } from "../executor/components/WorkflowHealthView.js";
import { useWorkflowHealth } from "../executor/useWorkflowHealth.js";
import { WORKFLOW_HEALTH_BANNER } from "../executor/types.js";

/**
 * Fleet workflow health (Sprint #30) — descriptive only.
 */
export function WorkflowHealthPage() {
  const { state, reload } = useWorkflowHealth(24);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <p className="sr-only">{WORKFLOW_HEALTH_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Workflow health</h1>
        <p className="mt-2 text-sm text-gray-400 max-w-xl">
          Workflow bottlenecks surfaced from authoritative worker evidence —
          descriptive state only, not operational intelligence.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading workflow health…
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

      {state.status === "ready" && <WorkflowHealthView health={state.health} />}

      {state.status === "idle" && (
        <p className="text-sm text-gray-500">Preparing workflow health…</p>
      )}
    </div>
  );
}
