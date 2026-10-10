/**
 * WorkflowTaskSidebar — left rail showing task progress.
 * UI Redesign: progress bar, cyan active state, better number circles.
 */

import { useEffect, useState }   from "react";
import { Badge }                 from "../ui/Badge.js";
import type { WorkflowRun, ConsensusAuditSummary, ConsensusQuorumState } from "../../api/types.js";
import {
  taskOutcomeBadge,
  taskDisplayLabel,
  runPhaseBadge,
} from "../../helpers/task-status.js";
import { getConsensusSummary }   from "../../api/client.js";

// ─── Consensus indicator (self-contained, renders only in multi mode) ─────────

function quorumDotClass(state: ConsensusQuorumState): string {
  switch (state) {
    case "unanimous":    return "bg-emerald-400";
    case "primary_only": return "bg-[#00D4FF]/70";
    case "scope_blocked":return "bg-amber-400";
    case "no_quorum":
    case "timeout":      return "bg-red-400";
  }
}

function quorumLabel(state: ConsensusQuorumState): string {
  switch (state) {
    case "unanimous":    return "Confirmed";
    case "primary_only": return "Partial";
    case "scope_blocked":return "Scope concern";
    case "no_quorum":    return "Not confirmed";
    case "timeout":      return "Timed out";
  }
}

function ConsensusIndicator() {
  const [latest, setLatest] = useState<ConsensusAuditSummary | null>(null);
  const [mode,   setMode]   = useState<string | null>(null);

  useEffect(() => {
    getConsensusSummary(1)
      .then(items => {
        if (items[0]) {
          setLatest(items[0]);
          setMode(items[0].policyMode);
        }
      })
      .catch(() => { /* multi-LLM not active — render nothing */ });
  }, []);

  if (!mode || mode === "claude") return null;

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-widest text-gray-700 font-semibold">
        Confidence check
      </span>
      {latest && (
        <>
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${quorumDotClass(latest.quorumState)}`} />
          <span className="text-[10px] text-gray-600">
            {quorumLabel(latest.quorumState)}
          </span>
          {(latest.quorumState === "no_quorum" || latest.quorumState === "timeout") && (
            <span className="text-[10px] text-gray-700 tabular-nums ml-auto">
              ({latest.roundCount} {latest.roundCount === 1 ? "attempt" : "attempts"})
            </span>
          )}
        </>
      )}
    </div>
  );
}

type Props = {
  run: WorkflowRun;
};

export function WorkflowTaskSidebar({ run }: Props) {
  const isReviewing = run.phase === "reviewing";
  const total       = run.spec.tasks.length;
  const done        = run.tasks.filter(t =>
    t.outcome !== null && t.outcome !== "pending",
  ).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <aside className="w-full md:w-64 md:flex-none border-b md:border-b-0 md:border-r
                      border-gray-800/60 bg-gray-950
                      overflow-y-auto scrollbar-thin flex flex-col">

      {/* Header + progress */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800/60 flex-none">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-600">
            Tasks
          </p>
          <p className="text-[10px] text-gray-700 tabular-nums">
            {done}/{total}
          </p>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#00D4FF] rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ConsensusIndicator />
      </div>

      {/* Task list */}
      <ul className="flex-1">
        {run.spec.tasks.map((specTask, idx) => {
          const liveTask  = run.tasks[idx];
          const isActive  = !isReviewing && run.currentIndex === idx &&
                            !run.phase.includes("completed") &&
                            !run.phase.includes("stopped");
          const outcome   = liveTask?.outcome ?? null;
          const isPending = outcome === null || outcome === "pending";
          const badge     = isPending
            ? (isActive ? runPhaseBadge(run.phase) : { label: "Pending", variant: "pending" as const })
            : taskOutcomeBadge(outcome);

          return (
            <li
              key={idx}
              className={`
                flex items-start gap-3 px-4 py-3 border-b border-gray-800/40
                ${isActive
                  ? "bg-[#00D4FF]/5 border-l-[3px] border-l-[#00D4FF]"
                  : "border-l-[3px] border-l-transparent"}
              `}
            >
              <span className={`
                flex-none w-5 h-5 rounded-full flex items-center justify-center
                text-[10px] font-mono font-semibold mt-0.5
                ${isActive
                  ? "bg-[#00D4FF] text-gray-950"
                  : outcome && outcome !== "pending"
                    ? "bg-gray-800 text-gray-600"
                    : "bg-gray-800 text-gray-600"}
              `}>
                {idx + 1}
              </span>

              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate
                  ${isActive ? "text-gray-100" : "text-gray-500"}`}>
                  {taskDisplayLabel(specTask, idx)}
                </p>
                {liveTask && liveTask.retryCount > 0 && (
                  <p className="text-[10px] text-amber-500 mt-0.5">
                    Retry ×{liveTask.retryCount}
                  </p>
                )}
                <div className="mt-1">
                  <Badge
                    label={badge.label}
                    variant={badge.variant as Parameters<typeof Badge>[0]["variant"]}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
