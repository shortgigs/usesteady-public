import type { DecisionHistoryEntry } from "../types.js";

type Props = {
  readonly entry: DecisionHistoryEntry;
  readonly isLast: boolean;
};

const STAGE_LABELS: Record<DecisionHistoryEntry["stage"], string> = {
  authority_granted:  "Authority granted",
  handler_invoked:    "Handler invoked",
  command_authorized: "Command authorized",
  mutation_applied:   "Mutation applied",
  halted:             "Halted",
};

export function DecisionStageRow({ entry, isLast }: Props) {
  const authorityLine =
    entry.stage === "authority_granted" && entry.authority_reference !== undefined
      ? ` by: ${entry.authority_reference}`
      : "";

  return (
    <li className="relative pl-6 pb-6">
      {!isLast && (
        <span
          className="absolute left-[7px] top-3 bottom-0 w-px bg-gray-700"
          aria-hidden="true"
        />
      )}
      <span
        className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-cyan-500/60 bg-gray-950"
        aria-hidden="true"
      />
      <div>
        <p className="text-sm font-medium text-gray-100">
          {STAGE_LABELS[entry.stage]}
          {authorityLine}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          <span className="text-cyan-200/80">{entry.decision}</span>
          {" · "}
          {entry.actor_id}
          {" · "}
          <time dateTime={entry.timestamp}>{entry.timestamp}</time>
        </p>
        {entry.reason !== undefined && (
          <p className="text-xs text-gray-400 mt-1">{entry.reason}</p>
        )}
        <p className="text-[10px] font-mono text-gray-600 mt-1">
          {entry.lineage_reference}
        </p>
        {entry.replay_reference !== undefined && (
          <p className="text-[10px] text-gray-500 mt-0.5">
            Replay lineage: {entry.replay_reference} (inspect only)
          </p>
        )}
      </div>
    </li>
  );
}
