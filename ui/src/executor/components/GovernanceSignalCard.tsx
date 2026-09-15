import type { GovernanceIndicator } from "../types.js";

type Props = {
  readonly indicator: GovernanceIndicator;
};

const KIND_LABEL: Record<GovernanceIndicator["kind"], string> = {
  invariant_pressure:          "Invariant pressure",
  boundary_proximity:          "Boundary proximity",
  replay_authority_separation: "Replay / authority separation",
  doctrine_consistency:        "Doctrine consistency",
  governance_drift:            "Governance drift",
  governance_lineage:          "Governance lineage",
};

export function GovernanceSignalCard({ indicator }: Props) {
  return (
    <li className="rounded border border-gray-800/80 bg-gray-900/50 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-cyan-500/80">
        {KIND_LABEL[indicator.kind]}
      </p>
      <p className="mt-1 font-medium text-gray-200">{indicator.label}</p>
      <p className="mt-1 text-xs text-gray-500">
        <span className="text-gray-600">Policy:</span>{" "}
        <span className="font-mono text-gray-400">{indicator.policy_reference}</span>
      </p>
      {indicator.count !== undefined && (
        <p className="mt-1 text-xs text-gray-500">Count: {indicator.count}</p>
      )}
      <p className="mt-2 text-xs text-gray-500">
        <span className="text-gray-600">Evidence:</span>{" "}
        <span className="font-mono text-gray-400 break-all">{indicator.evidence_ref}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">
        <span className="text-gray-600">Projection:</span>{" "}
        <span className="font-mono text-gray-400 break-all">{indicator.projection_ref}</span>
      </p>
      <p className="mt-2 text-[10px] text-gray-600">
        {indicator.observed_at} · {indicator.rule_reference}
      </p>
      {indicator.note !== undefined && (
        <p className="mt-1 text-xs text-gray-500">{indicator.note}</p>
      )}
    </li>
  );
}
