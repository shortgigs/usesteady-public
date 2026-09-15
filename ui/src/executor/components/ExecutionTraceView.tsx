import type { ExecutionTraceProjection } from "../types.js";
import { EXECUTION_OBSERVABILITY_BANNER } from "../types.js";

type Props = {
  readonly trace: ExecutionTraceProjection;
};

export function ExecutionTraceView({ trace }: Props) {
  return (
    <div
      className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-4 space-y-3"
      role="region"
      aria-label="Execution trace projection"
    >
      <p className="text-xs text-cyan-200/80">{EXECUTION_OBSERVABILITY_BANNER}</p>
      <dl className="grid gap-2 text-sm font-mono text-xs">
        <div>
          <dt className="text-gray-500 text-[10px] uppercase">Outcome</dt>
          <dd className="text-gray-200">{trace.terminal_outcome}</dd>
        </div>
        {trace.authority_record_id !== undefined && (
          <div>
            <dt className="text-gray-500 text-[10px] uppercase">Authority</dt>
            <dd className="text-gray-400 break-all">{trace.authority_record_id}</dd>
          </div>
        )}
        {trace.mutation_record_id !== undefined && (
          <div>
            <dt className="text-gray-500 text-[10px] uppercase">Mutation record</dt>
            <dd className="text-gray-400 break-all">{trace.mutation_record_id}</dd>
          </div>
        )}
        <div>
          <dt className="text-gray-500 text-[10px] uppercase">Source refs</dt>
          <dd className="text-gray-500 space-y-1">
            {trace.source_record_refs.map((ref) => (
              <div key={ref}>{ref}</div>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}
