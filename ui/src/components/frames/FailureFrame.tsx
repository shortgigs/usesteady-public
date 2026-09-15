/**
 * FailureFrame — failed or policy-blocked step.
 *
 * "I understand what failed and what to do next."
 *
 * UI Redesign:
 *   - Left accent border on error/policy cards (red/amber)
 *   - "You asked" as sunken card at bottom
 *   - Clear section separation
 *
 * UI-W7: failure cause preserved verbatim from coordinator.
 * UI-W2: buttons map only to existing choose choices.
 */

import { useState, useEffect } from "react";
import posthog                from "posthog-js";
import { Button }            from "../ui/Button.js";
import type { WorkflowRun }  from "../../api/types.js";
import type { FrameViewModel } from "../../adapters/shell-frame.js";
import {
  failureActions,
  getFailureSuggestion,
  getIsPolicyBlock,
  getIsCapabilitySplit,
  stripCapabilitySplitPrefix,
} from "../../helpers/failure.js";
import { taskDisplayLabel }  from "../../helpers/task-status.js";
import { FrictionReportModal } from "./FrictionReportModal.js";

type Props = {
  run:      WorkflowRun;
  vm:       FrameViewModel;
  onChoose: (idx: number) => void;
  loading?: boolean;
};

function YouAsked({ input }: { input: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-700 mb-1.5">
        You asked
      </p>
      <div className="rounded-xl border border-gray-800/60 bg-gray-950 px-4 py-3">
        <p className="font-mono text-xs text-gray-500 whitespace-pre-wrap break-words leading-relaxed">
          {input}
        </p>
      </div>
    </div>
  );
}

export function FailureFrame({ run, vm, onChoose, loading }: Props) {
  const taskIdx = run.currentIndex;
  const spec    = run.tasks[taskIdx]?.spec ?? run.spec.tasks[taskIdx]!;
  const label   = taskDisplayLabel(spec, taskIdx);
  const total   = run.spec.tasks.length;

  const failure          = vm.failure;
  const prompt           = vm.prompt;
  const choices          = prompt?.kind === "choose" ? prompt.choices : [];
  const actions          = failureActions(choices);
  const rawError         = failure?.what ?? "An unexpected error occurred.";
  const suggestion       = getFailureSuggestion(rawError);
  const isCapSplit       = getIsCapabilitySplit(rawError);
  const isPolicyBlock    = getIsPolicyBlock(rawError);

  const [showReportModal, setShowReportModal] = useState(false);

  // Fire telemetry once when a capability split is shown.
  useEffect(() => {
    if (isCapSplit) {
      posthog.capture("capability_split_shown", {
        task_input:   spec.input,
        run_id:       run.workflowRunId,
        task_index:   taskIdx,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Capability split layout ──────────────────────────────────────────────────
  // Primary model accepted, secondary couldn't complete it. Not a safety veto.
  if (isCapSplit) {
    const cleanMessage = stripCapabilitySplitPrefix(rawError);

    function trackAndChoose(action: { label: string; idx: number }) {
      const actionKind = action.label.toLowerCase().startsWith("retry") ? "retry"
                       : action.label.toLowerCase().startsWith("skip")  ? "skip"
                       : "stop";
      posthog.capture("capability_split_action", {
        action:     actionKind,
        task_input: spec.input,
        run_id:     run.workflowRunId,
      });
      onChoose(action.idx);
    }

    return (
      <>
      <div className="flex flex-col gap-5 max-w-2xl">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-[#00D4FF]/70 mb-1">
            Step {taskIdx + 1} of {total} — Couldn&apos;t confirm
          </p>
          <h3 className="text-xl font-bold text-gray-50">{label}</h3>
        </div>

        <div className="rounded-xl border border-[#00D4FF]/20 border-l-[3px] border-l-[#00D4FF]/60
                        bg-[#00D4FF]/5 p-5 flex flex-col gap-4">

          {/* Transient hint — most capability errors resolve on retry */}
          <div className="flex items-center gap-2 text-xs text-[#00D4FF]/80 font-medium">
            <span className="text-base leading-none">↻</span>
            Try again — this often succeeds on retry.
          </div>

          <p className="text-sm text-gray-300 leading-relaxed border-t border-[#00D4FF]/10 pt-3">
            {cleanMessage}
          </p>

          <div className="pt-3 border-t border-[#00D4FF]/15">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-700 mb-2">
              What you can do
            </p>
            <ul className="flex flex-col gap-1.5 text-xs text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-[#00D4FF]/50 flex-none mt-0.5">•</span>
                <span><strong className="text-gray-300">Retry</strong> — the primary model may succeed on its own</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00D4FF]/50 flex-none mt-0.5">•</span>
                <span><strong className="text-gray-300">Rephrase</strong> — make the instruction more specific and try again</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00D4FF]/50 flex-none mt-0.5">•</span>
                <span><strong className="text-gray-300">Skip</strong> — move to the next step</span>
              </li>
            </ul>
          </div>
        </div>

        <YouAsked input={spec.input} />

        {actions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {actions.map(action => (
              <Button
                key={action.idx}
                label={action.label}
                variant={action.variant}
                size="md"
                onClick={() => trackAndChoose(action)}
                loading={loading && action.variant === "primary"}
                disabled={loading}
              />
            ))}
          </div>
        )}

        <div className="pt-1">
          <button
            onClick={() => setShowReportModal(true)}
            className="text-[11px] text-gray-700 hover:text-gray-400 transition-colors underline-offset-2 hover:underline"
          >
            Report this friction → earn a payout if verified
          </button>
        </div>
      </div>

      {showReportModal && (
        <FrictionReportModal
          prefill={{
            phase:       run.phase,
            runId:       run.workflowRunId,
            taskInput:   spec.input,
            failureNote: cleanMessage,
          }}
          onClose={() => setShowReportModal(false)}
        />
      )}
      </>
    );
  }

  // ── Policy / governance block layout ─────────────────────────────────────────
  if (isPolicyBlock) {
    return (
      <>
      <div className="flex flex-col gap-5 max-w-2xl">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-amber-500 mb-1">
            Step {taskIdx + 1} of {total} — Blocked by policy
          </p>
          <h3 className="text-xl font-bold text-gray-50">{label}</h3>
        </div>

        <div className="rounded-xl border border-amber-900/50 border-l-[3px] border-l-amber-500
                        bg-amber-950/15 p-5 flex flex-col gap-4">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-500 mb-0">
            Change blocked by workspace policy
          </p>

          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-700 mb-1">
              What happened
            </p>
            <p className="font-mono text-amber-300/80 text-xs whitespace-pre-wrap leading-relaxed
                          bg-amber-950/30 rounded-lg px-3 py-2">
              {rawError}
            </p>
          </div>

          <div className="pt-3 border-t border-amber-900/30">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-700 mb-1.5">
              What you can do
            </p>
            <ul className="flex flex-col gap-1 text-xs text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-amber-700 flex-none mt-0.5">•</span>
                Modify the request to target a permitted scope
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-700 flex-none mt-0.5">•</span>
                Skip this step and continue with remaining tasks
              </li>
            </ul>
          </div>
        </div>

        <YouAsked input={spec.input} />

        {actions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {actions.map(action => (
              <Button
                key={action.idx}
                label={action.label}
                variant={action.variant}
                size="md"
                onClick={() => onChoose(action.idx)}
                loading={loading && action.variant === "primary"}
                disabled={loading}
              />
            ))}
          </div>
        )}

        <div className="pt-1">
          <button
            onClick={() => setShowReportModal(true)}
            className="text-[11px] text-gray-700 hover:text-gray-400 transition-colors underline-offset-2 hover:underline"
          >
            Report this friction → earn a payout if verified
          </button>
        </div>
      </div>

      {showReportModal && (
        <FrictionReportModal
          prefill={{ phase: run.phase, runId: run.workflowRunId, taskInput: spec.input }}
          onClose={() => setShowReportModal(false)}
        />
      )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">

      {/* Header */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold text-red-400 mb-1">
          Step {taskIdx + 1} of {total} — Failed
        </p>
        <h3 className="text-xl font-bold text-gray-50">{label}</h3>
      </div>

      {/* Error card with red left accent */}
      <div className="rounded-xl border border-red-900/40 border-l-[3px] border-l-red-500
                      bg-red-950/10 p-5 flex flex-col gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-red-400 mb-2">
            What happened
          </p>
          <p className="text-sm text-red-300 font-mono whitespace-pre-wrap leading-relaxed">
            {rawError}
          </p>
        </div>

        {suggestion && (
          <div className="pt-3 border-t border-red-900/30">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-1">
              Suggested next step
            </p>
            <p className="text-sm text-gray-400 leading-snug">{suggestion}</p>
          </div>
        )}

        <div className="pt-3 border-t border-red-900/30">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-2">
            What you can do
          </p>
          <ul className="flex flex-col gap-1.5">
            {actions.map(a => (
              <li key={a.idx} className="flex items-baseline gap-2 text-sm">
                <span className="font-medium text-gray-300">{a.label}:</span>
                <span className="text-gray-500">
                  {a.label.toLowerCase().startsWith("retry")
                    ? "run the same step again"
                    : a.label.toLowerCase().startsWith("skip")
                    ? "move to the next step"
                    : "end the workflow"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <YouAsked input={spec.input} />

      {actions.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {actions.map(action => (
            <Button
              key={action.idx}
              label={action.label}
              variant={action.variant}
              size="md"
              onClick={() => onChoose(action.idx)}
              loading={loading && action.variant === "primary"}
              disabled={loading}
            />
          ))}
        </div>
      )}

      {/* Friction report trigger */}
      <div className="pt-1">
        <button
          onClick={() => setShowReportModal(true)}
          className="text-[11px] text-gray-700 hover:text-gray-400 transition-colors underline-offset-2 hover:underline"
        >
          Report this friction → earn a payout if verified
        </button>
      </div>

      {showReportModal && (
        <FrictionReportModal
          prefill={{
            phase:       run.phase,
            runId:       run.workflowRunId,
            taskInput:   spec.input,
            failureNote: rawError,
          }}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}
