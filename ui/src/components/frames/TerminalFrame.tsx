/**
 * Terminal frame components — Completed, Stopped, Approved.
 *
 * "I know what actually happened."
 *
 * UI Redesign: cleaner outcome rows, refined ResultBlock, better action hierarchy.
 * UI-W3: no prompt → read-only.
 */

import { useNavigate }              from "react-router-dom";
import { Card }                     from "../ui/Card.js";
import { Badge }                    from "../ui/Badge.js";
import { RECOVERY_FORMATS, suggestRewrite } from "../../helpers/intent.js";
import { Button }                   from "../ui/Button.js";
import { runtimeBadgeLabel }        from "../../helpers/task-status.js";
import type {
  WorkflowRun,
  WorkflowTaskOutcome,
  RecoverySuggestion,
  TaskSkillSuggestions,
} from "../../api/types.js";
import { taskOutcomeBadge, taskDisplayLabel } from "../../helpers/task-status.js";

// ─── Per-task outcome row ─────────────────────────────────────────────────────

function OutcomeRow({
  idx, label, outcome, rawInput, suggestions, onSuggest,
}: {
  idx:          number;
  label:        string;
  outcome:      WorkflowTaskOutcome | null;
  rawInput?:    string;
  suggestions?: readonly RecoverySuggestion[];
  onSuggest?:   (input: string) => void;
}) {
  const badge         = taskOutcomeBadge(outcome);
  const isAutoSkipped = outcome === "skipped_by_intake";
  const isPlanningReviewed = outcome === "planning_reviewed";

  if (isPlanningReviewed) {
    return (
      <li className="py-3 px-5">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-5 h-5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF] mt-0.5
                           flex items-center justify-center text-[10px] font-mono flex-none">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-200">{label}</p>
            <p className="text-[11px] text-gray-500 mt-1">Planning step reviewed — no execution.</p>
          </div>
          <Badge label={badge.label} variant={badge.variant} />
        </div>
      </li>
    );
  }

  if (isAutoSkipped) {
    return (
      <li className="py-3 px-5">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-5 h-5 rounded-full bg-gray-800/80 text-gray-600 mt-0.5
                           flex items-center justify-center text-[10px] font-mono flex-none">
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">

            {/* COULD NOT UNDERSTAND card */}
            <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-3">
              <p className="text-[10px] uppercase tracking-wider font-bold text-amber-500 mb-2 tracking-widest">
                Could not understand
              </p>

              {/* Verbatim raw input */}
              <p className="font-mono text-xs text-amber-200/80
                            bg-zinc-950 border border-amber-900/30 rounded-lg px-3 py-2 mb-3
                            whitespace-pre-wrap break-words leading-relaxed">
                {rawInput ?? label}
              </p>

              {/* Reason */}
              <p className="text-[11px] text-amber-700/90 leading-snug mb-3">
                This step could not be understood because it does not match a supported operation.
                No files were changed.
              </p>

              {/* Context-aware rewrite — derived from the raw input pattern */}
              {(() => {
                const rewrite = suggestRewrite(rawInput ?? label ?? "");
                return rewrite ? (
                  <div className="mb-3 animate-slide-up-fade-in">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[#00D4FF]/80 mb-1.5 tracking-widest">
                      Suggested rewrite
                    </p>
                    <div className="rounded border border-[#00D4FF]/20 bg-[#00D4FF]/5
                                    px-2 py-1.5 flex items-start justify-between gap-2">
                      <span className="font-mono text-[10px] text-[#00D4FF]/90 block flex-1 min-w-0">
                        {rewrite}
                      </span>
                      {onSuggest && (
                        <button
                          type="button"
                          onClick={() => onSuggest(rewrite)}
                          className="flex-none text-xs font-semibold text-[#00D4FF]/70
                                     hover:text-[#00D4FF] hover:bg-[#00D4FF]/15
                                     min-h-[44px] sm:min-h-0 px-3 sm:px-2 py-2 sm:py-0.5
                                     rounded transition-all whitespace-nowrap
                                     border border-[#00D4FF]/20 hover:border-[#00D4FF]/50
                                     hover:scale-105 active:scale-95 hover:shadow-sm hover:shadow-[#00D4FF]/20"
                        >
                          Try this →
                        </button>
                      )}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* SYSTEM SUGGESTS — only shown when the skill produced suggestions */}
              {suggestions && suggestions.length > 0 && (
                <div className="mb-3 animate-slide-up-fade-in">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-[#00D4FF]/80 mb-1.5 tracking-widest">
                    System suggests
                  </p>
                  <ul className="flex flex-col gap-1">
                    {suggestions.map((s, i) => (
                      <li key={i}
                          className="rounded border border-[#00D4FF]/20 bg-[#00D4FF]/5
                                     px-2 py-1.5 flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-[10px] text-[#00D4FF]/90 block">
                            {s.input}
                          </span>
                          {s.reason && (
                            <span className="text-[9px] text-gray-600 mt-0.5 block leading-snug">
                              {s.reason}
                            </span>
                          )}
                        </div>
                        {onSuggest && (
                          <button
                            type="button"
                            onClick={() => onSuggest(s.input)}
                            className="flex-none text-xs font-semibold text-[#00D4FF]/70
                                       hover:text-[#00D4FF] hover:bg-[#00D4FF]/15
                                       min-h-[44px] sm:min-h-0 px-3 sm:px-2 py-2 sm:py-0.5
                                       rounded transition-all whitespace-nowrap
                                       border border-[#00D4FF]/20 hover:border-[#00D4FF]/50
                                       hover:scale-105 active:scale-95 hover:shadow-sm hover:shadow-[#00D4FF]/20"
                          >
                            Try this →
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-gray-700 mt-1.5 leading-snug">
                    Clicking "Try this" pre-fills the input — still requires your approval.
                  </p>
                </div>
              )}

              {/* WHAT YOU CAN DO */}
              <p className="text-[10px] uppercase tracking-wider font-bold text-gray-600 mb-1.5 tracking-widest">
                What you can do
              </p>
              <p className="text-[10px] text-gray-600 mb-1.5">
                Try one of these exact formats:
              </p>
              <ul className="flex flex-col gap-0.5">
                {RECOVERY_FORMATS.map(f => (
                  <li key={f}
                      className="font-mono text-[10px] text-gray-400
                                 bg-gray-900/60 rounded px-2 py-1 leading-none">
                    {f}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between py-3 px-5 gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-5 h-5 rounded-full bg-gray-800/80 text-gray-600 mt-0.5
                         flex items-center justify-center text-[10px] font-mono flex-none">
          {idx + 1}
        </span>
        <div className="min-w-0">
          <span className="text-sm text-gray-300 block truncate">{label}</span>
        </div>
      </div>
      <Badge label={badge.label} variant={badge.variant} />
    </li>
  );
}

// ─── Result summary ───────────────────────────────────────────────────────────

function ResultBlock({ run }: { run: WorkflowRun }) {
  const accepted    = run.tasks.filter(t => t.outcome === "accepted").length;
  const autoSkipped = run.tasks.filter(t => t.outcome === "skipped_by_intake").length;
  const userSkipped = run.tasks.filter(t => t.outcome === "skipped").length;
  const skipped     = autoSkipped + userSkipped;
  const total       = run.tasks.length;
  const allAutoSkipped = accepted === 0 && autoSkipped === total;

  return (
    <div className="rounded-xl bg-gray-900 border border-white/[0.07] px-5 py-4 flex flex-col gap-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-600 tracking-widest">
        Result
      </p>

      {allAutoSkipped ? (
        <div>
          <p className="text-sm text-gray-400 mb-2">No changes were applied.</p>
          <p className="text-[11px] text-amber-600 leading-snug mb-1.5">
            None of the steps could be understood well enough to run.
          </p>
          <p className="text-[10px] text-gray-600">
            Each step above shows the exact reason and formats that work.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-5 text-sm flex-wrap">
          {accepted > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-emerald-400 leading-none">{accepted}</span>
              <span className="text-gray-500 text-xs">completed</span>
            </div>
          )}
          {skipped > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-amber-400 leading-none">{skipped}</span>
              <span className="text-gray-500 text-xs">skipped</span>
            </div>
          )}
          <span className="text-gray-700 text-xs ml-auto">of {total} total</span>
        </div>
      )}
    </div>
  );
}

// ─── CompletedFrame ───────────────────────────────────────────────────────────

export function CompletedFrame({
  run, onReset, skillSuggestions, onSuggest,
}: {
  run:               WorkflowRun;
  onReset?:          () => void;
  skillSuggestions?: readonly TaskSkillSuggestions[];
  onSuggest?:        (input: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-400 mb-1">
          Workflow Completed
        </p>
        <h2 className="text-2xl font-bold text-gray-50">{run.spec.name}</h2>
      </div>

      <ResultBlock run={run} />

      <Card padded={false}>
        <ul className="divide-y divide-gray-800/60">
          {run.tasks.map((task, idx) => (
            <OutcomeRow
              key={idx}
              idx={idx}
              label={taskDisplayLabel(task.spec, idx)}
              outcome={task.outcome}
              rawInput={task.spec.input}
              suggestions={skillSuggestions?.find(s => s.taskIndex === idx)?.suggestions}
              onSuggest={onSuggest}
            />
          ))}
        </ul>
      </Card>

      <p className="text-sm text-gray-600">
        Full details are available in{" "}
        <button
          type="button"
          onClick={() => navigate("/history")}
          className="text-[#00D4FF]/70 hover:text-[#00D4FF] underline underline-offset-2 transition-colors"
        >
          workflow history
        </button>.
      </p>

      <div className="flex items-center gap-3">
        <Button
          label="View full audit"
          variant="outline"
          size="md"
          onClick={() => navigate("/history")}
        />
        {onReset && (
          <Button
            label="Start new workflow"
            variant="ghost"
            size="md"
            onClick={onReset}
          />
        )}
      </div>
    </div>
  );
}

// ─── StoppedFrame ─────────────────────────────────────────────────────────────

export function StoppedFrame({
  run, onReset, skillSuggestions, onSuggest,
}: {
  run:               WorkflowRun;
  onReset?:          () => void;
  skillSuggestions?: readonly TaskSkillSuggestions[];
  onSuggest?:        (input: string) => void;
}) {
  const navigate   = useNavigate();
  const stoppedIdx = run.tasks.findIndex(t => t.outcome === "stopped");
  const ranCount   = run.tasks.filter(t =>
    t.outcome !== null && t.outcome !== "pending",
  ).length;

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-400 mb-1">
          Workflow Stopped
        </p>
        <h2 className="text-2xl font-bold text-gray-50">{run.spec.name}</h2>
        {stoppedIdx !== -1 && (
          <p className="text-sm text-gray-500 mt-1">
            Stopped at step {stoppedIdx + 1} of {run.spec.tasks.length}
            {ranCount > 0 && ` · ${ranCount} step${ranCount !== 1 ? "s" : ""} ran`}
          </p>
        )}
      </div>

      <Card padded={false}>
        <ul className="divide-y divide-gray-800/60">
          {run.tasks.map((task, idx) => (
            <OutcomeRow
              key={idx}
              idx={idx}
              label={taskDisplayLabel(task.spec, idx)}
              outcome={task.outcome}
              rawInput={task.spec.input}
              suggestions={skillSuggestions?.find(s => s.taskIndex === idx)?.suggestions}
              onSuggest={onSuggest}
            />
          ))}
        </ul>
      </Card>

      <p className="text-sm text-gray-600">
        Partial history recorded.{" "}
        <button
          type="button"
          onClick={() => navigate("/history")}
          className="text-[#00D4FF]/70 hover:text-[#00D4FF] underline underline-offset-2 transition-colors"
        >
          View history
        </button>.
      </p>

      <div className="flex items-center gap-3">
        <Button
          label="View full audit"
          variant="outline"
          size="md"
          onClick={() => navigate("/history")}
        />
        {onReset && (
          <Button
            label="Start new workflow"
            variant="ghost"
            size="md"
            onClick={onReset}
          />
        )}
      </div>
    </div>
  );
}

// ─── ApprovedFrame — transient bridge state ───────────────────────────────────

export function ApprovedFrame({ run }: { run: WorkflowRun }) {
  const taskIdx = run.currentIndex;
  const spec    = run.spec.tasks[taskIdx]!;
  const label   = taskDisplayLabel(spec, taskIdx);

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-[#00D4FF]/70 mb-1">
          Step {taskIdx + 1} — Approved
        </p>
        <h3 className="text-xl font-bold text-gray-50">{label}</h3>
      </div>
      <p className="text-sm text-gray-400">
        Approved. Delivering to {runtimeBadgeLabel(spec.runtime)}…
      </p>
      <div className="flex items-center gap-2.5 text-gray-500 text-sm">
        <span className="size-4 border-2 border-gray-700 border-t-[#00D4FF]
                         rounded-full animate-spin flex-none" />
        Executing…
      </div>
    </div>
  );
}
