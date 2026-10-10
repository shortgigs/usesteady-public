/**
 * Phase 3 — Session Timeline (read-only).
 *
 * Shows all decided steps for a session in chronological order (decided_at ASC).
 * This is an audit trail, not an interaction surface — no mutations here.
 *
 * Design rules:
 *   - Read-only. No approve/reject controls.
 *   - Chronological, not step_index order (captures actual decision sequence).
 *   - Compact rows — scannable at 30+ entries without scrolling fatigue.
 *   - Risk + decision signal visible at a glance on each row.
 *   - Empty state when no decisions yet — not an error.
 *
 * S3 (Workspace Shell Baseline): rendering now routes through the shared
 * Timeline primitive. Data fetching, visible text, and read-only invariant
 * are unchanged. Only getSessionTimeline is imported from the client.
 */

import { useEffect, useState } from "react";
import type { TimelineEntry } from "../../api/types.js";
import { getSessionTimeline } from "../../api/client.js";
import { STATUS_TONE } from "../../helpers/status-tone.js";
import type { StatusTone } from "../../helpers/status-tone.js";
import { Timeline } from "../ui/Timeline.js";

// ─── Tokens ───────────────────────────────────────────────────────────────────

const DECISION_COLOR = {
  approved: STATUS_TONE.success.text,
  rejected: STATUS_TONE.neutral.text,
};

const DECISION_LABEL = {
  approved: "✓ Approved",
  rejected: "✕ Rejected",
};

/** Maps execution risk level to a StatusTone for the Timeline dot. */
const RISK_TONE: Record<string, StatusTone> = {
  low:    "success",
  medium: "warning",
  high:   "danger",
};

const ACTION_ICON: Record<string, string> = {
  create: "＋",
  update: "～",
  delete: "✕",
  rename: "→",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  sessionId: string;
};

type LoadState = "loading" | "ready" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionTimeline({ sessionId }: Props) {
  const [entries,   setEntries]   = useState<TimelineEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg,  setErrorMsg]  = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    getSessionTimeline(sessionId)
      .then(({ entries: fetched }) => {
        if (cancelled) return;
        setEntries(fetched);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load timeline.");
        setLoadState("error");
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (loadState === "loading") {
    return (
      <div className="py-10 text-center text-sm text-gray-600">
        Loading timeline…
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="py-6 rounded-lg border border-red-900/40 bg-red-950/20 text-center text-sm text-red-400">
        {errorMsg}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-gray-600">
        No decisions yet — approve or reject steps to build the timeline.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Column header strip */}
      <div className="flex items-center gap-4 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-700">
        <span className="pl-6">Step</span>
        <span className="ml-auto pr-1">Decision</span>
      </div>

      <Timeline aria-label="Approval timeline">
        {entries.map((entry, i) => {
          const tone: StatusTone = RISK_TONE[entry.risk_level] ?? "neutral";

          const title = (
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              {/* Action icon */}
              <span className="text-gray-600 font-mono shrink-0 text-xs">
                {ACTION_ICON[entry.action_type] ?? "·"}
              </span>
              {/* Step index */}
              <span className="text-gray-700 shrink-0 text-xs">#{entry.stepIndex + 1}</span>
              {/* File path */}
              <code className="text-cyan-400 font-mono truncate text-[11px] flex-1">
                {entry.file_path}
              </code>
              {/* Decision badge — right-aligned */}
              <span
                className={`shrink-0 font-bold text-[10px] uppercase tracking-wider ml-2
                            ${DECISION_COLOR[entry.decision]}`}
              >
                {DECISION_LABEL[entry.decision]}
              </span>
            </div>
          );

          const detail = (
            <div className="flex items-center gap-2">
              {/* Timestamp */}
              <span className="font-mono text-gray-600 text-[10px] tabular-nums">
                {formatTime(entry.decided_at)}
              </span>
              {entry.summary && (
                <span className="text-gray-600 truncate text-[10px]">{entry.summary}</span>
              )}
            </div>
          );

          return (
            <Timeline.Item
              key={entry.stepId}
              id={entry.stepId}
              title={title}
              tone={tone}
              detail={detail}
              isLast={i === entries.length - 1}
            />
          );
        })}
      </Timeline>

      {/* Summary footer */}
      <div className="pt-3 flex justify-between text-[10px] text-gray-700 px-2">
        <span>{entries.length} decision{entries.length !== 1 ? "s" : ""} recorded</span>
        <span>
          {entries.filter(e => e.decision === "approved").length} approved
          {" · "}
          {entries.filter(e => e.decision === "rejected").length} rejected
        </span>
      </div>
    </div>
  );
}
