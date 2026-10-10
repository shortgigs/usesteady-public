/**
 * RunDetailPage — the per-run detail page (route /history/:workflowRunId).
 *
 * Run header + status-checks summary row + expandable per-step timeline, plus
 * recent policy-layer (multi-LLM consensus) verdicts when present. Reuses the
 * Tier-2 audit read model via useWorkflowAudit.
 *
 * UI-W4: reads persisted records only, never live coordinator state. No authority.
 */

import { useParams, useNavigate }         from "react-router-dom";
import { useWorkflowAudit, useConsensusSummary } from "../hooks/useWorkflowHistory.js";
import { LoadingState }                   from "../components/ui/LoadingState.js";
import { ErrorState }                     from "../components/ui/ErrorState.js";
import { EmptyState }                     from "../components/ui/EmptyState.js";
import { Badge }                          from "../components/ui/Badge.js";
import { RunStatusChecks }                from "../components/runs/RunStatusChecks.js";
import { RunStepRow }                     from "../components/runs/RunStepRow.js";
import type { ConsensusQuorumState }      from "../api/types.js";

// ─── Policy-layer helpers (ported from the prior detail pane) ──────────────────

function quorumBadge(state: ConsensusQuorumState): { variant: "accepted" | "reviewing" | "skipped" | "failed"; label: string } {
  switch (state) {
    case "unanimous":     return { variant: "accepted",  label: "Unanimous"     };
    case "primary_only":  return { variant: "reviewing", label: "Primary only"  };
    case "scope_blocked": return { variant: "skipped",   label: "Scope blocked" };
    case "no_quorum":     return { variant: "failed",    label: "No quorum"     };
    case "timeout":       return { variant: "failed",    label: "Timeout"       };
  }
}

function policyModeLabel(mode: string): string {
  if (mode === "multi-strict") return "multi-strict";
  if (mode === "multi")        return "multi";
  return "claude";
}

export function RunDetailPage() {
  const { workflowRunId = null } = useParams<{ workflowRunId: string }>();
  const navigate  = useNavigate();
  const audit     = useWorkflowAudit(workflowRunId);
  const consensus = useConsensusSummary(10);

  const detail = audit.detail;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header bar with back link */}
      <header className="flex items-center gap-2 px-5 py-3 border-b border-gray-800/60
                         flex-none bg-gray-950">
        <button
          type="button"
          onClick={() => navigate("/history")}
          className="text-xs text-gray-500 hover:text-gray-200 transition-colors
                     inline-flex items-center gap-1"
        >
          <span aria-hidden>‹</span> Runs
        </button>
        <span className="text-gray-700">/</span>
        <span className="font-semibold text-gray-100 text-sm truncate">
          {detail?.name ?? "Run"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {audit.loading && <LoadingState label="Loading record…" />}

        {audit.error && (
          <div className="p-6">
            <ErrorState message={audit.error} />
          </div>
        )}

        {!audit.loading && !audit.error && !detail && (
          <EmptyState
            icon="🔍"
            title="Run not found."
            description="This record may have been removed or the ID is incorrect."
          />
        )}

        {detail && (
          <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-6">
            {/* Run header */}
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-700 mb-1">
                    Workflow run
                  </p>
                  <h1 className="text-xl font-bold text-gray-50 leading-tight">{detail.name}</h1>
                  <p className="text-xs text-gray-600 mt-0.5">{detail.date}</p>
                </div>
                <Badge
                  label={detail.finalOutcome === "completed" ? "Completed" : "Stopped"}
                  variant={detail.finalOutcome === "completed" ? "accepted" : "stopped"}
                  size="md"
                />
              </div>

              <div className="flex items-center gap-4 text-sm flex-wrap">
                <span className="flex items-baseline gap-1">
                  <span className="text-emerald-300 font-semibold">{detail.acceptedCount}</span>
                  <span className="text-gray-600 text-xs">/{detail.taskCount} accepted</span>
                </span>
                {detail.skippedCount > 0 && (
                  <span className="flex items-baseline gap-1">
                    <span className="text-amber-300 font-semibold">{detail.skippedCount}</span>
                    <span className="text-gray-600 text-xs">skipped</span>
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-gray-800">
                  {detail.workflowRunId.slice(0, 12)}…
                </span>
              </div>
            </div>

            {/* Status-checks summary row */}
            <RunStatusChecks tasks={detail.tasks} />

            {/* Step timeline */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-700 mb-3">
                Steps
              </p>
              <ul className="flex flex-col gap-2">
                {detail.tasks.map(task => (
                  <RunStepRow key={task.taskIndex} task={task} />
                ))}
              </ul>
            </div>

            {/* Policy layer — recent consensus verdicts (when multi-LLM mode active) */}
            {consensus.items.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-700">
                    Policy layer
                  </p>
                  <span className="text-[10px] text-gray-700">— recent verdicts</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {consensus.items.map((item, i) => {
                    const { variant, label } = quorumBadge(item.quorumState);
                    return (
                      <li
                        key={i}
                        className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-900/50"
                      >
                        <Badge label={label} variant={variant} />
                        <span className="text-[10px] font-mono text-gray-700 flex-none">
                          {policyModeLabel(item.policyMode)}
                        </span>
                        <span className="text-[10px] text-gray-700 tabular-nums flex-none">
                          {item.roundCount} round{item.roundCount !== 1 ? "s" : ""}
                        </span>
                        {item.failedClosedReason && (
                          <span className="text-[10px] text-gray-600 truncate min-w-0"
                                title={item.failedClosedReason}>
                            {item.failedClosedReason}
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-gray-800 truncate flex-none">
                          {item.requestId.slice(0, 16)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
