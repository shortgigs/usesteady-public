/**
 * RunStepRow — one collapsible step in the run detail step timeline.
 *
 * Collapsed: step number, a truncated "you asked" line, outcome chip, and a
 * retry hint. Expanded: the full instruction, outcome, and step-history runtime.
 * Tone-colored left border for scan-level emphasis.
 *
 * Read-only (UI-W4): renders a persisted audit entry; no authority.
 */

import { useState }         from "react";
import { Badge }            from "../ui/Badge.js";
import { STATUS_TONE }      from "../../helpers/status-tone.js";
import { BADGE_VARIANT_TONE, type BadgeVariant } from "../../helpers/task-status.js";
import type { AuditTaskItem } from "../../adapters/history.js";

type Props = {
  task: AuditTaskItem;
};

const RUNTIME_LABEL: Record<string, string> = {
  cursor:  "Local edit",
  claude:  "Claude",
  unknown: "Unknown",
};

export function RunStepRow({ task }: Props) {
  const [open, setOpen] = useState(false);
  const variant = task.outcomeBadge.variant as BadgeVariant;
  const accent  = STATUS_TONE[BADGE_VARIANT_TONE[variant]].leftBorder;

  return (
    <li>
      <div className={`rounded-lg bg-gray-900 border border-gray-800/60
                       border-l-[3px] ${accent}`}>
        {/* Collapsed header — click to toggle */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="w-full text-left px-4 py-3 flex items-center gap-3
                     transition-colors hover:bg-gray-800/30 rounded-lg"
        >
          <span className={`text-gray-600 flex-none transition-transform text-xs
                            ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
          <span className="w-5 h-5 rounded-full bg-gray-800 text-gray-500 flex-none
                           flex items-center justify-center text-[10px] font-mono font-semibold">
            {task.taskIndex + 1}
          </span>
          <span className="min-w-0 flex-1 font-mono text-xs text-gray-400 truncate">
            {task.input}
          </span>
          {task.retryCount > 0 && (
            <span className="text-[10px] text-amber-300/80 flex-none">
              {task.retryCount} retr{task.retryCount > 1 ? "ies" : "y"}
            </span>
          )}
          <Badge label={task.outcomeBadge.label} variant={variant} />
        </button>

        {/* Expanded detail */}
        {open && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-800/40">
            <p className="text-[10px] uppercase tracking-wider font-semibold
                          text-[#00D4FF]/60 mb-1.5 mt-3">
              You asked
            </p>
            <div className="rounded-lg border border-gray-800/60 bg-gray-950 px-3 py-2.5 mb-4">
              <p className="font-mono text-xs text-gray-400 whitespace-pre-wrap
                            break-words leading-relaxed">
                {task.input}
              </p>
            </div>

            <div className="flex items-start gap-6 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold
                              text-gray-600 mb-1.5">
                  Outcome
                </p>
                <Badge label={task.outcomeBadge.label} variant={variant} size="md" />
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold
                              text-gray-600 mb-1.5">
                  Step history
                </p>
                {task.hasSession && task.runtime ? (
                  <Badge
                    label={RUNTIME_LABEL[task.runtime] ?? task.runtime}
                    variant={task.runtime === "cursor" ? "active" : "reviewing"}
                    size="md"
                  />
                ) : (
                  <p className="text-xs text-gray-700 italic">No execution recorded.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
