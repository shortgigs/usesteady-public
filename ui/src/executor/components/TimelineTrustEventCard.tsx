import type { TimelineTrustEvent } from "../types.js";

type Props = {
  readonly event: TimelineTrustEvent;
};

const KIND_BADGE: Record<TimelineTrustEvent["kind"], string> = {
  stage_marker:        "bg-gray-800 text-gray-300",
  state_transition:    "bg-blue-950/50 text-blue-200",
  decision_point:      "bg-cyan-950/50 text-cyan-200",
  refusal_point:       "bg-amber-950/50 text-amber-200",
  lineage_anchor:      "bg-gray-900 text-gray-400",
  health_snapshot_ref: "bg-purple-950/50 text-purple-200",
};

export function TimelineTrustEventCard({ event }: Props) {
  return (
    <li className="rounded-lg border border-gray-800/80 bg-gray-900/30 p-3">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span
          className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${KIND_BADGE[event.kind]}`}
        >
          {event.kind.replace(/_/g, " ")}
        </span>
        <time className="text-xs font-mono text-gray-500">{event.at}</time>
      </div>
      <p className="text-sm font-medium text-gray-100">{event.label}</p>
      <p className="mt-1 text-xs font-mono text-gray-500 break-all">{event.record_ref}</p>
      {event.prior_state !== undefined && event.next_state !== undefined && (
        <p className="mt-1 text-xs text-gray-400">
          {event.prior_state} → {event.next_state}
        </p>
      )}
      {event.decision !== undefined && (
        <p className="mt-1 text-xs text-gray-400">Decision: {event.decision}</p>
      )}
      {event.refusal_reason !== undefined && (
        <p className="mt-1 text-xs text-amber-200/90">Refusal: {event.refusal_reason}</p>
      )}
      {event.lineage_ref !== undefined && (
        <p className="mt-1 text-xs font-mono text-gray-500">{event.lineage_ref}</p>
      )}
      {event.note !== undefined && (
        <p className="mt-1 text-xs text-gray-500">{event.note}</p>
      )}
    </li>
  );
}
