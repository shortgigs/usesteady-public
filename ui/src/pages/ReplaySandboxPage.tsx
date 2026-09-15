import { useParams } from "react-router-dom";

import { ReplayExecutionCtaPanel } from "../executor/components/ReplayExecutionCtaPanel.js";
import { ReplaySandboxView } from "../executor/components/ReplaySandboxView.js";
import { useReplayExecution } from "../executor/useReplayExecution.js";
import { useReplaySandbox } from "../executor/useReplaySandbox.js";
import { REPLAY_SANDBOX_BANNER } from "../executor/types.js";

/**
 * Per-execution replay sandbox (Sprint #36b) — isolated simulation only.
 */
export function ReplaySandboxPage() {
  const { job_id } = useParams<{ job_id: string }>();
  const { state, reload } = useReplaySandbox(job_id);
  const execution = useReplayExecution(job_id);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <p className="sr-only">{REPLAY_SANDBOX_BANNER}</p>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-cyan-500/80 mb-1">
          Execution trust
        </p>
        <h1 className="text-2xl font-bold text-white">Replay Sandbox</h1>
        <p className="mt-2 text-sm text-gray-400">
          Isolated replay simulation candidate — descriptive staging only.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="text-sm text-gray-500" role="status">
          Loading replay sandbox…
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
        <>
          <ReplayExecutionCtaPanel
            job_id={job_id}
            sandbox_ready
            execution={execution}
          />
          <ReplaySandboxView replay_sandbox={state.replay_sandbox} />
        </>
      )}

      {state.status === "idle" && (
        <p className="text-sm text-gray-500">Preparing replay sandbox…</p>
      )}
    </div>
  );
}
