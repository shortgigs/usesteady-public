import type { DiagnosticFinding } from "../types.js";

type Props = {
  readonly finding: DiagnosticFinding;
};

const KIND_LABEL: Record<DiagnosticFinding["kind"], string> = {
  halt_cluster:         "Halt cluster",
  retry_window:         "Retry window",
  queue_hotspot:        "Queue hotspot",
  mutation_instability: "Mutation instability",
  refusal_density:      "Refusal density",
  lineage_diagnostic:   "Lineage reference",
};

export function DiagnosticSignalCard({ finding }: Props) {
  return (
    <li className="rounded border border-gray-800/80 bg-gray-900/50 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-cyan-500/80">
        {KIND_LABEL[finding.kind]}
      </p>
      <p className="mt-1 font-medium text-gray-200">{finding.label}</p>
      {finding.count !== undefined && (
        <p className="mt-1 text-xs text-gray-500">Count: {finding.count}</p>
      )}
      <p className="mt-2 text-xs text-gray-500">
        <span className="text-gray-600">Evidence:</span>{" "}
        <span className="font-mono text-gray-400 break-all">{finding.evidence_ref}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">
        <span className="text-gray-600">Projection:</span>{" "}
        <span className="font-mono text-gray-400 break-all">{finding.projection_ref}</span>
      </p>
      <p className="mt-2 text-[10px] text-gray-600">
        {finding.observed_at} · {finding.rule_reference}
      </p>
      {finding.note !== undefined && (
        <p className="mt-1 text-xs text-gray-500">{finding.note}</p>
      )}
    </li>
  );
}
