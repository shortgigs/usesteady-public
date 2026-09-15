import type { WorkerChainStatusProjection } from "../types.js";
import { WORKER_CHAIN_STATUS_BANNER } from "../types.js";

type Props = {
  readonly projection: WorkerChainStatusProjection;
};

const PHASE_LABELS: Record<WorkerChainStatusProjection["phase"], string> = {
  awaiting_authority: "Awaiting authority",
  awaiting_job:       "Awaiting job",
  worker_pending:     "Worker pending",
  chain_halted:       "Chain halted",
  chain_completed:    "Chain completed",
};

export function WorkerExecutionStatus({ projection }: Props) {
  return (
    <div
      className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 space-y-3"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs text-cyan-200/80">{WORKER_CHAIN_STATUS_BANNER}</p>
      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-gray-500">Phase</dt>
          <dd className="font-mono text-gray-200">{PHASE_LABELS[projection.phase]}</dd>
        </div>
        {projection.terminal_outcome !== undefined && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-gray-500">Outcome</dt>
            <dd className="font-mono text-gray-200">{projection.terminal_outcome}</dd>
          </div>
        )}
        {projection.halt_cause !== undefined && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-gray-500">Halt cause</dt>
            <dd className="font-mono text-amber-200/90">{projection.halt_cause}</dd>
          </div>
        )}
        {projection.authority_record_id !== undefined && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-gray-500">Authority</dt>
            <dd className="font-mono text-gray-400 text-xs break-all">
              {projection.authority_record_id}
            </dd>
          </div>
        )}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-gray-500">Job</dt>
          <dd className="font-mono text-gray-400 text-xs break-all">{projection.job_id}</dd>
        </div>
        {projection.descriptive_replay === true && (
          <p className="text-xs text-gray-500">Descriptive replay — prior terminal state.</p>
        )}
      </dl>
    </div>
  );
}
