/**
 * RunRow — one scannable row in the workflow-runs list.
 *
 * Light, single-line-first layout: a tone-colored status dot, the workflow
 * name, a compact step-count meta, a success bar, and a relative time. The
 * whole row is a button that navigates to the per-run detail page.
 *
 * Read-only (UI-W4): renders a persisted Tier-1 history summary; no authority.
 */

import { Badge }            from "../ui/Badge.js";
import { STATUS_TONE }      from "../../helpers/status-tone.js";
import type { HistoryListItem } from "../../adapters/history.js";

type Props = {
  item:    HistoryListItem;
  onOpen:  (runId: string) => void;
};

/** Compact relative time ("2h ago", "3d ago"); falls back to the formatted date. */
function relativeTime(iso: string, fallback: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return fallback;
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 45)      return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60)      return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)     return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30)      return `${days}d ago`;
  return fallback;
}

export function RunRow({ item, onOpen }: Props) {
  const pct       = Math.round(item.successRate * 100);
  const completed = item.finalOutcome === "completed";
  const tone      = completed ? STATUS_TONE.success : STATUS_TONE.neutral;

  const meta = [
    `${item.taskCount} step${item.taskCount !== 1 ? "s" : ""}`,
    item.acceptedCount > 0 && `${item.acceptedCount} done`,
    item.skippedCount  > 0 && `${item.skippedCount} skipped`,
  ].filter(Boolean).join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.executionInstanceId)}
        className="group w-full text-left px-5 py-3.5 flex items-center gap-3
                   transition-colors hover:bg-gray-800/30
                   border-l-[3px] border-l-transparent hover:border-l-gray-700"
      >
        {/* Status dot */}
        <span className={`w-2.5 h-2.5 rounded-full flex-none ${tone.dot}`} aria-hidden />

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-200 truncate group-hover:text-gray-50">
              {item.name}
            </p>
            <Badge
              label={completed ? "Completed" : "Stopped"}
              variant={completed ? "accepted" : "stopped"}
            />
          </div>
          <p className="text-xs text-gray-600 mt-0.5 truncate">{meta}</p>
        </div>

        {/* Success bar + count */}
        <div className="hidden sm:flex items-center gap-2 flex-none w-32">
          <div className="flex-1 h-1.5 bg-gray-800/80 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/70 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-700 flex-none tabular-nums">
            {item.acceptedCount}/{item.taskCount}
          </span>
        </div>

        {/* Relative time + chevron */}
        <span className="text-[11px] text-gray-700 flex-none tabular-nums w-16 text-right"
              title={item.date}>
          {relativeTime(item.ts, item.date)}
        </span>
        <span className="text-gray-700 flex-none group-hover:text-gray-500" aria-hidden>›</span>
      </button>
    </li>
  );
}
