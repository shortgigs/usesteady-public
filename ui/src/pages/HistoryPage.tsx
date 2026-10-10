/**
 * HistoryPage — the workflow-runs list.
 *
 * A single-column, scannable list of runs. Each row links to the per-run
 * detail page (/history/:workflowRunId). Reuses the Tier-1 history read model.
 *
 * UI-W4: reads persisted records only, never live coordinator state.
 */

import { useNavigate }      from "react-router-dom";
import { RunRow }           from "../components/runs/RunRow.js";
import { EmptyState }       from "../components/ui/EmptyState.js";
import { LoadingState }     from "../components/ui/LoadingState.js";
import { ErrorState }       from "../components/ui/ErrorState.js";
import { Button }           from "../components/ui/Button.js";
import { useWorkflowHistory } from "../hooks/useWorkflowHistory.js";
import { InfoTooltip }      from "../components/ui/InfoTooltip.js";

export function HistoryPage() {
  const navigate = useNavigate();
  const history  = useWorkflowHistory();

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3
                         border-b border-gray-800/60 flex-none bg-gray-950">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-100 text-sm">Workflow runs</span>
          {!history.loading && (
            <span className="text-xs text-gray-700">
              {history.items.length} run{history.items.length !== 1 ? "s" : ""}
            </span>
          )}
          <InfoTooltip side="bottom">
            <p className="text-[11px] font-semibold text-gray-200 mb-2 leading-snug">
              UseSteady vs. CI/CD
            </p>
            <ul className="flex flex-col gap-1.5 text-[11px] text-gray-400 leading-snug">
              <li>
                <span className="text-[#00D4FF]/80 font-medium">UseSteady</span>
                {" "}controls <span className="text-gray-200">what runs</span>
                {" "}— before execution.
              </li>
              <li>
                <span className="text-gray-300 font-medium">CI/CD</span>
                {" "}validates <span className="text-gray-200">what ran</span>
                {" "}— after execution.
              </li>
            </ul>
            <p className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-gray-700/60">
              They are not duplicates. This record answers why a change ran,
              not whether it passed tests.
            </p>
          </InfoTooltip>
        </div>
        <Button
          label="Refresh"
          variant="ghost"
          size="sm"
          onClick={() => history.refresh()}
          loading={history.loading}
        />
      </header>

      {/* Runs list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {history.loading && <LoadingState label="Loading…" />}
        {history.error && (
          <div className="p-4">
            <ErrorState
              message={history.error}
              onRetry={() => history.refresh()}
            />
          </div>
        )}
        {!history.loading && !history.error && history.items.length === 0 && (
          <EmptyState
            title="No workflow runs yet."
            description="Run your first workflow to see what changed, why it changed, and the complete step record."
          />
        )}
        {!history.loading && !history.error && history.items.length > 0 && (
          <ul className="divide-y divide-gray-800/50 max-w-3xl mx-auto">
            {history.items.map(item => (
              <RunRow
                key={item.executionInstanceId}
                item={item}
                onOpen={runId => navigate(`/history/${runId}`)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
