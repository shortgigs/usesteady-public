/**
 * Phase 11A-Web: WorkflowFramePanel — dispatches to frame components.
 *
 * This is the web equivalent of the CLI's generic loop:
 *   - branches on run.phase first
 *   - then on frame.prompt?.kind
 *   - never on runtime identity
 *
 * UI-W1: reads frozen contract outputs; does not reinterpret.
 * UI-W2: controls only call existing shell actions via callbacks.
 * UI-W3: if frame has no prompt → read-only terminal component.
 *
 * Break-glass (BG-2): when run.mode === "break_glass" and phase is task_ready,
 * BreakGlassAutoFrame renders a read-only card and fires onConfirm(true) once
 * per task via useEffect. This aligns web behavior with the coordinator's
 * effectiveYes = true — no new authority, same advance path as user clicking Approve.
 */

import { useEffect, useRef }        from "react";
import { ReviewingFrame }           from "../frames/ReviewingFrame.js";
import { ApprovalFrame }            from "../frames/ApprovalFrame.js";
import { FailureFrame }             from "../frames/FailureFrame.js";
import { ScopeClarificationFrame }  from "../frames/ScopeClarificationFrame.js";
import {
  CompletedFrame,
  StoppedFrame,
  ApprovedFrame,
} from "../frames/TerminalFrame.js";
import { LoadingSpinner }           from "../ui/LoadingSpinner.js";
import { shellFrameToViewModel }    from "../../adapters/shell-frame.js";
import type { WorkflowRun, ShellFrame, TaskSkillSuggestions } from "../../api/types.js";

type Props = {
  run:               WorkflowRun;
  frame:             ShellFrame;
  loading:           boolean;
  onConfirm:         (yes: boolean) => void;
  onChoose:          (idx: number)  => void;
  onReset?:          () => void;
  skillSuggestions?: readonly TaskSkillSuggestions[];
  onSuggest?:        (input: string) => void;
};

// ─── Break-glass auto-advance (F4) ───────────────────────────────────────────
//
// Renders when run.mode === "break_glass" AND phase === "task_ready".
// Shows a read-only amber card (no Approve button) and fires onConfirm(true)
// exactly once per task to match the coordinator's effectiveYes = true (BG-2).
//
// Safety conditions on the useEffect:
//   - dep array [workflowRunId, currentIndex] → fires once per unique task slot
//   - firedRef → prevents double-fire on fast re-renders within the same task
//   - loading guard → waits until the previous advance has settled

function BreakGlassAutoFrame({
  run,
  onConfirm,
  loading,
}: {
  run:       WorkflowRun;
  onConfirm: (yes: boolean) => void;
  loading:   boolean;
}) {
  const firedRef = useRef(false);

  useEffect(() => {
    // Reset the guard whenever we move to a new task
    firedRef.current = false;
  }, [run.workflowRunId, run.currentIndex]);

  useEffect(() => {
    if (loading || firedRef.current) return;
    firedRef.current = true;
    onConfirm(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.workflowRunId, run.currentIndex, loading]);

  const task  = run.tasks?.[run.currentIndex];
  const label = task?.spec?.label ?? task?.spec?.input?.slice(0, 60) ?? "Step";
  const total = run.tasks?.length ?? 0;

  return (
    <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-400 font-bold text-xs tracking-widest">⚡ BREAK-GLASS — AUTO-APPROVING</span>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="text-[11px] text-gray-500 font-mono">
          Step {(run.currentIndex ?? 0) + 1} of {total}
        </p>
        <p className="text-sm font-semibold text-gray-200 leading-snug">{label}</p>
      </div>

      <p className="text-[11px] text-amber-500/80 leading-snug">
        Running without per-step approval.{" "}
        {run.breakGlassReason && (
          <span className="text-amber-600/70">Reason: {run.breakGlassReason}</span>
        )}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="animate-pulse">●</span> Executing…
        </div>
      )}
    </div>
  );
}

export function WorkflowFramePanel({
  run, frame, loading, onConfirm, onChoose, onReset, skillSuggestions, onSuggest,
}: Props) {
  const vm = shellFrameToViewModel(frame);

  // ── Phase-first dispatch ──────────────────────────────────────────────────

  switch (run.phase) {

    case "reviewing":
      return (
        <ReviewingFrame
          run={run}
          onStart={() => onConfirm(true)}
          onCancel={() => onConfirm(false)}
          loading={loading}
        />
      );

    case "task_ready":
      // Break-glass: skip approval UI, auto-advance (BG-2).
      // Non-break-glass: normal approval UI unchanged.
      if (run.mode === "break_glass") {
        return (
          <BreakGlassAutoFrame run={run} onConfirm={onConfirm} loading={loading} />
        );
      }
      return (
        <ApprovalFrame
          run={run}
          vm={vm}
          isConflict={false}
          onApprove={() => onConfirm(true)}
          onReject={() => onConfirm(false)}
          onStop={() => onConfirm(false)}
          loading={loading}
        />
      );

    case "task_conflict":
      // Break-glass: also auto-advance through conflicts (user declared emergency).
      if (run.mode === "break_glass") {
        return (
          <BreakGlassAutoFrame run={run} onConfirm={onConfirm} loading={loading} />
        );
      }
      return (
        <ApprovalFrame
          run={run}
          vm={vm}
          isConflict={true}
          onApprove={() => onConfirm(true)}
          onReject={() => onConfirm(false)}
          onStop={() => onConfirm(false)}
          loading={loading}
        />
      );

    case "task_failed":
      return (
        <FailureFrame
          run={run}
          vm={vm}
          onChoose={onChoose}
          loading={loading}
        />
      );

    case "task_scope":
      return (
        <ScopeClarificationFrame
          run={run}
          vm={vm}
          onChoose={onChoose}
          loading={loading}
        />
      );

    case "task_approved":
    case "running":
      return <ApprovedFrame run={run} />;

    case "completed":
      return (
        <CompletedFrame
          run={run}
          onReset={onReset}
          skillSuggestions={skillSuggestions}
          onSuggest={onSuggest}
        />
      );

    case "stopped":
      return (
        <StoppedFrame
          run={run}
          onReset={onReset}
          skillSuggestions={skillSuggestions}
          onSuggest={onSuggest}
        />
      );

    default:
      return (
        <div className="text-sm text-gray-500 p-4">
          <p className="font-mono">{vm.headline}</p>
          {loading && <LoadingSpinner label="Processing…" />}
        </div>
      );
  }
}
