/**
 * ReviewingFrame — pre-run review screen.
 *
 * USESTEADY_WORKPLAN_GENERATION_V1 — surfaces goal, nextAction, terminalOutcome.
 *
 * WF-R4: rendered for the reviewing phase.
 * WF-R2: must not trigger coordinator automatically on mount.
 */

import { Badge }   from "../ui/Badge.js";
import { Button }  from "../ui/Button.js";
import { Card }    from "../ui/Card.js";
import type { WorkflowRun, WorkPlanTask } from "../../api/types.js";
import { taskDisplayLabel, runtimeBadgeLabel, runtimeDescription } from "../../helpers/task-status.js";

type Props = {
  run:      WorkflowRun;
  onStart:  () => void;
  onCancel: () => void;
  loading?: boolean;
};

function capitalize(s: string): string {
  return s.length > 0 ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

function nextActionLabel(tasks: readonly WorkPlanTask[], nextActionId: string): string {
  const task = tasks.find(t => t.id === nextActionId);
  if (!task) return nextActionId;
  return `${capitalize(task.operatorAction)}: ${task.action} ${task.target}`;
}

export function ReviewingFrame({ run, onStart, onCancel, loading }: Props) {
  const { spec } = run;
  const workPlan = spec.workPlan;
  const isPlanningReview = spec.planningReviewHeadline !== undefined || workPlan !== undefined;

  return (
    <div className="flex flex-col gap-5 max-w-2xl">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-50 leading-tight">{spec.name}</h2>
        {isPlanningReview && spec.planningReviewHeadline ? (
          <p className="text-sm text-[#00D4FF]/80 mt-2 leading-relaxed">
            {spec.planningReviewHeadline}
          </p>
        ) : (
          <p className="text-sm text-gray-500 mt-1">
            {spec.tasks.length} step{spec.tasks.length !== 1 ? "s" : ""} — review before starting
          </p>
        )}
      </div>

      {/* Work plan summary — goal, next action, terminal outcome */}
      {workPlan && (
        <div className="rounded-xl border border-[#00D4FF]/20 bg-[#00D4FF]/5 px-4 py-4 flex flex-col gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[#00D4FF]/60 mb-1">
              What you are making
            </p>
            <p className="text-sm font-semibold text-gray-100 leading-snug">{workPlan.goal}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[#00D4FF]/60 mb-1">
              Your next action
            </p>
            <p className="text-sm text-[#00D4FF]/90 font-medium">
              {nextActionLabel(workPlan.tasks, workPlan.nextAction)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[#00D4FF]/60 mb-1">
              When this plan is done
            </p>
            <p className="text-sm text-gray-300 leading-snug">{workPlan.terminalOutcome}</p>
          </div>
        </div>
      )}

      {/* Break-glass warning — declared before task list */}
      {run.mode === "break_glass" && (
        <div className="rounded-xl border border-amber-800/50 border-l-[3px] border-l-amber-500
                        bg-amber-950/20 px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-400 text-base flex-none leading-none mt-0.5">⚡</span>
            <div>
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide mb-1">
                Break-glass mode
              </p>
              <p className="text-sm text-amber-200 leading-snug">
                This workflow will run without step-by-step approvals.
                All actions will be recorded in the workflow record.
              </p>
              {run.breakGlassReason && (
                <div className="mt-2 pt-2 border-t border-amber-900/40">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 mb-0.5">
                    Stated reason
                  </p>
                  <p className="text-xs text-amber-500 font-mono">{run.breakGlassReason}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Execution location */}
      {run.workspaceRoot ? (
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/15 px-4 py-3
                        flex items-center gap-3">
          <span className="text-base flex-none">📁</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 mb-0.5">
              Execution location
            </p>
            <p className="text-sm font-mono text-emerald-300 truncate">{run.workspaceRoot}</p>
            <p className="text-[11px] text-emerald-800 mt-0.5">
              {isPlanningReview
                ? "Planning review only — no filesystem changes in this workflow."
                : "All steps will modify files inside this workspace only."}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-amber-500/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-300 mb-0.5">
            Execution location
          </p>
          <p className="text-xs text-amber-300/80">
            No workspace set — execution will use the server default location.
          </p>
        </div>
      )}

      {/* Trust callout — cyan accent */}
      <div className="flex items-start gap-3 rounded-xl bg-[#00D4FF]/5
                      border border-[#00D4FF]/15 px-4 py-3">
        <span className="text-[#00D4FF]/60 mt-0.5 flex-none text-sm">ℹ</span>
        <div>
          <p className="text-sm font-semibold text-[#00D4FF]/80">
            Nothing has been executed yet.
          </p>
          <p className="text-sm text-[#00D4FF]/50 mt-0.5">
            You'll approve each step before it runs.
          </p>
        </div>
      </div>

      {/* Task list */}
      <Card padded={false}>
        <ul className="divide-y divide-gray-800/60">
          {spec.tasks.map((task, idx) => {
            const planTask = workPlan?.tasks[idx];
            const isNext = planTask?.id === workPlan?.nextAction;
            return (
              <li key={idx} className={`flex items-start gap-4 px-5 py-4 ${isNext ? "bg-[#00D4FF]/5" : ""}`}>
                <span className={`flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono
                                 font-semibold mt-0.5 ${isNext ? "bg-[#00D4FF]/20 text-[#00D4FF]" : "bg-gray-800 text-gray-500"}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-200">
                    {taskDisplayLabel(task, idx)}
                  </p>
                  {planTask ? (
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                      Outcome: {planTask.outcome}
                    </p>
                  ) : (
                    <p className="text-xs font-mono text-gray-600 mt-0.5 break-words leading-relaxed">
                      {task.input}
                    </p>
                  )}
                  {task.targetFiles && task.targetFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {task.targetFiles.map(f => (
                        <span key={f} className="font-mono text-[10px] bg-gray-800
                                                 text-gray-600 rounded px-1.5 py-0.5">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-gray-700 mt-1.5">
                    {isPlanningReview
                      ? isNext
                        ? "Your next action — review only, no execution."
                        : "Planning step — review only, no execution."
                      : runtimeDescription(task.runtime)}
                  </p>
                </div>
                <Badge
                  label={isNext ? "Next" : runtimeBadgeLabel(task.runtime)}
                  variant="active"
                />
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          label="Start workflow"
          variant="primary"
          size="lg"
          onClick={onStart}
          loading={loading}
        />
        <Button
          label="Cancel"
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={loading}
        />
      </div>
    </div>
  );
}
