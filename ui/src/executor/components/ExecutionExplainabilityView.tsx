import type { ExecutionExplainabilityRecord } from "../types.js";

type Props = {
  readonly explain: ExecutionExplainabilityRecord;
};

export function ExecutionExplainabilityView({ explain }: Props) {
  return (
    <div
      className="rounded-lg border border-gray-800 px-4 py-4 space-y-3"
      role="region"
      aria-label="Execution explainability record"
    >
      <p className="text-sm text-gray-200">{explain.summary}</p>
      {explain.authority_consumed_ref !== undefined && (
        <p className="text-xs text-gray-400">
          Authority consumed:{" "}
          <span className="font-mono break-all">{explain.authority_consumed_ref}</span>
        </p>
      )}
      {explain.mutation_decision_explain !== undefined && (
        <p className="text-xs text-gray-300">{explain.mutation_decision_explain}</p>
      )}
      {explain.halt_cause !== undefined && (
        <p className="text-xs text-amber-200/90">Halt: {explain.halt_cause}</p>
      )}
      <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
        {explain.chain_stage_summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {explain.replay_lineage_ref.length > 0 && (
        <p className="text-xs text-gray-600 font-mono">
          Replay lineage: {explain.replay_lineage_ref.join(" · ")}
        </p>
      )}
      {explain.descriptive_replay === true && (
        <p className="text-xs text-gray-600">Descriptive replay — prior evidence only.</p>
      )}
    </div>
  );
}
