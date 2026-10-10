import { Timeline } from "../../components/ui/Timeline.js";
import type { ExecutionTimelineProjection } from "../types.js";

type Props = {
  readonly timeline: ExecutionTimelineProjection;
};

const KIND_LABELS: Record<string, string> = {
  worker_terminal:     "Worker terminal",
  authority_consumed:  "Authority consumed",
  handler_invoked:     "Handler invoked",
  command_executed:    "Command executed",
  mutation_applied:    "Mutation applied",
  halted:              "Halted",
};

export function ExecutionTimelineView({ timeline }: Props) {
  return (
    <Timeline aria-label="Execution timeline projection">
      {timeline.entries.map((entry, i) => {
        const detail =
          entry.decision !== undefined || entry.note !== undefined ? (
            <>
              {entry.decision !== undefined && (
                <span className="text-cyan-200/80">{entry.decision}</span>
              )}
              {entry.note !== undefined && (
                <span className={entry.decision !== undefined ? "block mt-0.5 text-gray-500" : ""}>
                  {entry.note}
                </span>
              )}
            </>
          ) : undefined;

        return (
          <Timeline.Item
            key={`${entry.kind}-${entry.record_ref}-${i}`}
            id={`${entry.kind}-${entry.record_ref}-${i}`}
            title={
              <span className="text-gray-400">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
            }
            timestamp={entry.at}
            detail={detail}
            isLast={i === timeline.entries.length - 1}
          />
        );
      })}
    </Timeline>
  );
}
