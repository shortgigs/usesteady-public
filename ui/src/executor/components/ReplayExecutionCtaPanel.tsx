/**
 * Record-only replay execution CTA — explicit confirmation, no auto-run.
 * @see docs/product/prex-ui-execution-cta-implementation-contract-v1.md
 */

import { useCallback, useState } from "react";

import {
  REPLAY_EXECUTION_BUTTON_LABEL,
  REPLAY_EXECUTION_CONFIRM_LABEL,
  REPLAY_EXECUTION_DISCLOSURE,
  REPLAY_EXECUTION_NO_WORKER_NOTE,
  REPLAY_EXECUTION_OUTCOME_PREFIX,
} from "../replay-execution-copy.js";
import type { useReplayExecution } from "../useReplayExecution.js";

export type ReplayExecutionPanelPhase =
  | "idle"
  | "confirming"
  | "executing"
  | "success"
  | "blocked"
  | "expired"
  | "failed";

type ExecutionHook = ReturnType<typeof useReplayExecution>;

type Props = {
  readonly job_id: string;
  readonly sandbox_ready: boolean;
  readonly execution: ExecutionHook;
};

const STATE_HEADLINE: Record<
  "executed" | "blocked" | "expired",
  string
> = {
  executed: "Executed (record only)",
  blocked:  "Blocked (record only)",
  expired:  "Expired (record only)",
};

function derivePanelPhase(
  confirming: boolean,
  hook: ExecutionHook["state"],
): ReplayExecutionPanelPhase {
  if (hook.status === "loading") return "executing";
  if (hook.status === "error") return "failed";
  if (hook.status === "success") {
    const st = hook.replay_execution.replay_execution_state;
    if (st === "blocked") return "blocked";
    if (st === "expired") return "expired";
    return "success";
  }
  if (confirming) return "confirming";
  return "idle";
}

export function ReplayExecutionCtaPanel({
  job_id,
  sandbox_ready,
  execution,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const phase = derivePanelPhase(confirming, execution.state);

  const cancelConfirm = useCallback(() => {
    setConfirming(false);
  }, []);

  const startConfirm = useCallback(() => {
    if (!sandbox_ready || phase !== "idle") return;
    setConfirming(true);
  }, [sandbox_ready, phase]);

  const confirmRecord = useCallback(() => {
    setConfirming(false);
    void execution.record();
  }, [execution]);

  const buttonDisabled =
    !sandbox_ready ||
    phase === "executing" ||
    phase === "success" ||
    phase === "blocked" ||
    phase === "expired";

  return (
    <section
      aria-label="Replay execution CTA"
      aria-busy={phase === "executing"}
      className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4 mb-6"
    >
      <p className="text-sm text-amber-100/90">{REPLAY_EXECUTION_DISCLOSURE}</p>
      <p className="mt-2 text-xs text-amber-200/70">{REPLAY_EXECUTION_NO_WORKER_NOTE}</p>

      {phase === "idle" && (
        <button
          type="button"
          disabled={buttonDisabled}
          onClick={startConfirm}
          className="mt-4 min-h-11 px-4 py-2 rounded-md bg-cyan-600/90 text-white text-sm font-medium hover:bg-cyan-500/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {REPLAY_EXECUTION_BUTTON_LABEL}
        </button>
      )}

      {phase === "confirming" && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={confirmRecord}
            className="min-h-11 px-4 py-2 rounded-md bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500"
          >
            {REPLAY_EXECUTION_CONFIRM_LABEL}
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            className="min-h-11 px-4 py-2 rounded-md border border-gray-600 text-gray-300 text-sm hover:border-gray-500"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === "executing" && (
        <p className="mt-4 text-sm text-gray-400" role="status">
          Recording replay execution…
        </p>
      )}

      {(phase === "success" || phase === "blocked" || phase === "expired") &&
        execution.state.status === "success" && (
          <div className="mt-4 rounded-md border border-gray-700/80 bg-gray-900/50 p-3 text-sm">
            <p className="font-medium text-gray-200">
              {REPLAY_EXECUTION_OUTCOME_PREFIX} —{" "}
              {STATE_HEADLINE[execution.state.replay_execution.replay_execution_state]}
            </p>
            <dl className="mt-3 grid gap-2 text-xs text-gray-400">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-gray-600">
                  Replay execution ID
                </dt>
                <dd className="font-mono break-all text-gray-300">
                  {execution.state.replay_execution.replay_execution_id}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-gray-600">Job ID</dt>
                <dd className="font-mono text-gray-300">{job_id}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-gray-600">Reason</dt>
                <dd className="text-gray-300">
                  {execution.state.replay_execution.replay_execution_reason}
                </dd>
              </div>
            </dl>
          </div>
        )}

      {phase === "failed" && execution.state.status === "error" && (
        <div className="mt-4 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-200">
          <p>{execution.state.explain}</p>
          <p className="mt-1 text-xs text-red-300/80 font-mono">
            {execution.state.rejection_cause}
          </p>
        </div>
      )}
    </section>
  );
}
