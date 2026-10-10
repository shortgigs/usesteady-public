import type { CorrelationTrustLink } from "../types.js";

type Props = {
  readonly link: CorrelationTrustLink;
};

const KIND_LABEL: Record<CorrelationTrustLink["kind"], string> = {
  timeline_health:       "Timeline ↔ Health",
  halt_mutation:         "Halt ↔ Mutation",
  retry_queue_pressure:  "Retry ↔ Queue pressure",
  decision_failure:      "Decision ↔ Failure",
  lineage_evidence:      "Lineage evidence",
};

export function CorrelationSignalCard({ link }: Props) {
  return (
    <li className="rounded border border-gray-800/80 bg-gray-900/50 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-cyan-500/80">
        {KIND_LABEL[link.kind]}
      </p>
      <p className="mt-1 font-medium text-gray-200">{link.label}</p>
      <p className="mt-2 text-xs text-gray-500">
        <span className="text-gray-600">Left:</span>{" "}
        <span className="font-mono text-gray-400 break-all">{link.left_ref}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">
        <span className="text-gray-600">Right:</span>{" "}
        <span className="font-mono text-gray-400 break-all">{link.right_ref}</span>
      </p>
      <p className="mt-2 text-[10px] text-gray-600">
        {link.observed_at} · {link.rule_reference}
      </p>
      {link.note !== undefined && (
        <p className="mt-1 text-xs text-gray-500">{link.note}</p>
      )}
    </li>
  );
}
