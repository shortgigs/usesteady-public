/**
 * RunStatusChecks — the status-checks summary row for a run.
 *
 * A compact, light strip that summarizes a run's step outcomes at a glance:
 * one chip per present outcome (Approved / Skipped / Failed / Stopped /
 * Pending) with a count. Self-contained — derives everything from the audit
 * task list. No API calls, no authority (UI-W4).
 */

import { statusChipClass }   from "../../helpers/status-tone.js";
import { BADGE_VARIANT_TONE, type BadgeVariant } from "../../helpers/task-status.js";
import type { AuditTaskItem } from "../../adapters/history.js";

type Props = {
  tasks: readonly AuditTaskItem[];
};

// Fixed display order + neutral label per variant for the checks strip.
const CHECK_ORDER: ReadonlyArray<{ variant: BadgeVariant; label: string }> = [
  { variant: "accepted",  label: "Approved" },
  { variant: "skipped",   label: "Skipped"  },
  { variant: "failed",    label: "Failed"   },
  { variant: "stopped",   label: "Stopped"  },
  { variant: "pending",   label: "Pending"  },
];

export function RunStatusChecks({ tasks }: Props) {
  const counts = new Map<BadgeVariant, number>();
  for (const task of tasks) {
    const v = task.outcomeBadge.variant as BadgeVariant;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const present = CHECK_ORDER.filter(c => (counts.get(c.variant) ?? 0) > 0);

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-lg
                    bg-gray-900/50 px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-gray-700
                       flex-none mr-1">
        Checks
      </span>
      {present.length === 0 && (
        <span className="text-xs text-gray-600">No steps recorded.</span>
      )}
      {present.map(c => (
        <span key={c.variant} className={statusChipClass(BADGE_VARIANT_TONE[c.variant])}>
          {c.label}
          <span className="tabular-nums opacity-80">{counts.get(c.variant)}</span>
        </span>
      ))}
      <span className="ml-auto text-[11px] text-gray-700 tabular-nums flex-none">
        {tasks.length} step{tasks.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
