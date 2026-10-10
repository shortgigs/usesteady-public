import type { ApplyFixViewModel } from "../types.js";
import { CopyableId } from "./CopyableId.js";

type Props = {
  view: ApplyFixViewModel;
};

export function ApplyFixHeader({ view }: Props) {
  return (
    <section aria-labelledby="apply-fix-status-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="apply-fix-status-heading"
          className="text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          Status
        </h2>
        <span className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-300">
          {view.capability_id}
        </span>
        <span className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400">
          {view.job_kind}
        </span>
        <span className="text-xs px-2 py-0.5 rounded border border-emerald-800/50 text-emerald-400/90">
          {view.transport_state}
        </span>
      </div>

      <p className="text-sm text-gray-300 leading-relaxed">{view.intent_summary}</p>

      <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Authority</p>
        <p className="text-sm text-gray-200">{view.authority.message}</p>
        <p className="text-xs font-mono text-gray-500">{view.authority.kind}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CopyableId label="view_id" value={view.view_id} />
        <CopyableId label="execution_id" value={view.execution_id} />
        <CopyableId label="ledger_entry_id" value={view.ledger_entry_id} />
        <CopyableId label="handler_intent_id" value={view.handler_intent_id} />
        <CopyableId label="job_id" value={view.job_id} />
        <CopyableId label="payload_hash" value={view.payload_hash} />
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gray-400">
        <div>
          <dt className="text-gray-500">Actor</dt>
          <dd className="text-gray-300 mt-0.5">{view.actor_id}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Recorded</dt>
          <dd className="text-gray-300 mt-0.5 font-mono">{view.recorded_at}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Enqueued</dt>
          <dd className="text-gray-300 mt-0.5 font-mono">{view.enqueued_at}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Store seq</dt>
          <dd className="text-gray-300 mt-0.5">{view.store_sequence}</dd>
        </div>
      </dl>
    </section>
  );
}
