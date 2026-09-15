import { Timeline } from "../../components/ui/Timeline.js";
import type { StatusTone } from "../../helpers/status-tone.js";
import type { WorkerChainStatusPhase } from "../types.js";

type Props = {
  readonly phase: WorkerChainStatusPhase;
  readonly recorded_at: string;
};

const STAGES: readonly {
  readonly id: WorkerChainStatusPhase | "intake";
  readonly label: string;
}[] = [
  { id: "intake",             label: "Server intake accepted" },
  { id: "awaiting_authority", label: "Authority minted (operator path)" },
  { id: "awaiting_job",       label: "Job enqueued" },
  { id: "worker_pending",     label: "Worker transport" },
  { id: "chain_completed",    label: "Chain completed" },
  { id: "chain_halted",       label: "Chain halted" },
];

function stageIndex(phase: WorkerChainStatusPhase): number {
  const order: readonly WorkerChainStatusPhase[] = [
    "awaiting_authority",
    "awaiting_job",
    "worker_pending",
    "chain_completed",
    "chain_halted",
  ];
  const idx = order.indexOf(phase);
  return idx >= 0 ? idx + 1 : 0;
}

/** Pending dot uses bg-gray-700 to distinguish from "done" (bg-gray-500/neutral). */
const PENDING_DOT = (
  <span className="inline-block w-3.5 h-3.5 rounded-full bg-gray-700" aria-hidden="true" />
);

export function WorkerExecutionTimeline({ phase, recorded_at }: Props) {
  const activeIdx = stageIndex(phase);
  const terminal = phase === "chain_completed" || phase === "chain_halted";

  const visibleStages = STAGES.filter(
    (s) => s.id !== "chain_halted" || phase === "chain_halted",
  );

  return (
    <Timeline aria-label="Worker chain timeline (descriptive)">
      {visibleStages.map((stage, i) => {
        const isIntake = stage.id === "intake";
        const done =
          isIntake ||
          (stage.id === "chain_halted"
            ? phase === "chain_halted"
            : stage.id === "chain_completed"
              ? phase === "chain_completed"
              : !terminal && activeIdx > i);
        const current =
          !isIntake &&
          (stage.id === phase ||
            (stage.id === "chain_completed" && phase === "chain_completed") ||
            (stage.id === "chain_halted" && phase === "chain_halted"));

        // Pending stages use a custom darker dot so they visually differ from done.
        const tone: StatusTone = current ? "accent" : "neutral";
        const icon = (!done && !current) ? PENDING_DOT : undefined;

        const detail = current ? (
          <span className="text-cyan-300/80">(current)</span>
        ) : undefined;

        return (
          <Timeline.Item
            key={stage.id}
            id={stage.id}
            title={
              <span className={done ? "text-gray-300" : "text-gray-600"}>
                {stage.label}
              </span>
            }
            tone={tone}
            icon={icon}
            detail={detail}
            isLast={i === visibleStages.length - 1}
          />
        );
      })}
      <li className="text-xs text-gray-500 font-mono pt-1 pl-6">
        Recorded {recorded_at}
      </li>
    </Timeline>
  );
}
