/**
 * Phase 2 edge validation — all four pressure-test items addressed:
 *
 * 1. Multi-file clarity  — changes section shows count in header, collapses at >4 files
 * 2. Risk visibility     — HIGH RISK banner is visible at list-scan level (above content)
 * 3. Reject continuity   — collapsed rejected state reads "Workflow will skip this change"
 * 4. Large step counts   — decided cards are single-line; list stays scannable at 30 steps
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { ExecutionStep } from "../../api/types.js";
import { recordStepDecision } from "../../api/client.js";
import { STATUS_TONE, type StatusTone } from "../../helpers/status-tone.js";

// ─── Tokens ───────────────────────────────────────────────────────────────────

// Risk level → semantic tone (single source of truth in status-tone.ts).
const RISK_TONE: Record<ExecutionStep["risk_level"], StatusTone> = {
  low:    "success",
  medium: "warning",
  high:   "danger",
};

const RISK_BADGE: Record<ExecutionStep["risk_level"], string> = {
  low:    STATUS_TONE[RISK_TONE.low].chip,
  medium: STATUS_TONE[RISK_TONE.medium].chip,
  high:   STATUS_TONE[RISK_TONE.high].chip,
};

// Left border: low stays neutral-gray (no positive emphasis for the default case).
const RISK_LEFT_BORDER: Record<ExecutionStep["risk_level"], string> = {
  low:    STATUS_TONE.neutral.leftBorder,
  medium: STATUS_TONE.warning.leftBorder,
  high:   STATUS_TONE.danger.leftBorder,
};

const ACTION_ICON: Record<ExecutionStep["action_type"], string> = {
  create: "＋",
  update: "～",
  delete: "✕",
  rename: "→",
};

const ACTION_COLOR: Record<ExecutionStep["action_type"], string> = {
  create: "text-cyan-400",
  update: "text-gray-300",
  delete: "text-red-400",
  rename: "text-amber-400",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  step:       ExecutionStep;
  index:      number;
  focused:    boolean;
  onDecision: (stepId: string, decision: "approved" | "rejected") => void;
  onFocus:    () => void;
};

// Number of file changes shown before "...and N more" collapses the rest.
const CHANGES_VISIBLE_LIMIT = 4;

// ─── Component ────────────────────────────────────────────────────────────────

export function ExecutionStepCard({ step, index, focused, onDecision, onFocus }: Props) {
  const isHighRisk  = step.risk_level === "high";
  const isMedium    = step.risk_level === "medium";
  const isDone      = step.status === "approved" || step.status === "rejected";
  const isApproved  = step.status === "approved";
  const isRejected  = step.status === "rejected";

  const [whyOpen,      setWhyOpen]      = useState(isHighRisk);
  const [changesOpen,  setChangesOpen]  = useState(true);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [pending,      setPending]      = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const multiFile    = step.system_will.changes.length > 1;
  const fileCount    = step.system_will.changes.length;
  const visibleFiles = showAllFiles
    ? step.system_will.changes
    : step.system_will.changes.slice(0, CHANGES_VISIBLE_LIMIT);
  const hiddenCount  = fileCount - CHANGES_VISIBLE_LIMIT;

  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focused]);

  const decide = useCallback(async (decision: "approved" | "rejected") => {
    if (pending || isDone) return;
    setPending(true);
    try {
      await recordStepDecision(step.id, decision);
      onDecision(step.id, decision);
    } finally {
      setPending(false);
    }
  }, [pending, isDone, step.id, onDecision]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isDone || pending) return;
    if (e.key === "a" || e.key === "A") { e.preventDefault(); void decide("approved"); }
    if (e.key === "r" || e.key === "R") { e.preventDefault(); void decide("rejected"); }
  }

  // ── [3] DECIDED — compact single-line with continuity message ─────────────
  if (isDone) {
    return (
      <div
        ref={cardRef}
        className={`
          flex items-center gap-3 px-4 py-2.5 rounded-xl border
          ${isApproved
            ? "border-emerald-900/30 bg-emerald-950/10"
            : "border-gray-800/60   bg-gray-900/30"}
          opacity-60
        `}
      >
        {/* Status badge */}
        <span className={`text-xs font-bold uppercase tracking-wider flex-none w-20
          ${isApproved ? "text-emerald-500" : "text-gray-500"}`}>
          {isApproved ? "✓ Approved" : "✕ Rejected"}
        </span>

        <span className="text-gray-700 text-xs shrink-0">·</span>

        {/* Action + file */}
        <span className={`text-xs font-mono shrink-0 ${ACTION_COLOR[step.action_type]}`}>
          {ACTION_ICON[step.action_type]}
        </span>
        <span className="text-xs text-gray-500 font-mono truncate">
          {step.file_path}
          {multiFile && <span className="text-gray-700 ml-1">+{fileCount - 1} more</span>}
        </span>

        {/* [3] Continuity message for rejected steps */}
        {isRejected && (
          <span className="ml-auto text-[10px] text-gray-600 shrink-0 hidden sm:block">
            Workflow will skip this change
          </span>
        )}
        {isApproved && (
          <span className="ml-auto text-[10px] text-gray-700 shrink-0 hidden sm:block truncate max-w-48">
            {step.system_will.summary}
          </span>
        )}
      </div>
    );
  }

  // ── PENDING — full card ────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      tabIndex={0}
      role="region"
      aria-label={`Step ${index + 1}: ${step.system_will.summary}`}
      onClick={onFocus}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      className={`
        rounded-xl border-l-4 border border-gray-700 bg-gray-900
        outline-none transition-all duration-150
        ${RISK_LEFT_BORDER[step.risk_level]}
        ${focused ? "ring-1 ring-[#00D4FF]/30 border-gray-600" : "hover:border-gray-600"}
      `}
    >
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
          Step {index + 1}
        </span>
        <span className={`text-[11px] font-bold uppercase tracking-wider ${ACTION_COLOR[step.action_type]}`}>
          {ACTION_ICON[step.action_type]} {step.action_type}
        </span>
        {/* [1] Show file count in header for multi-file steps */}
        {multiFile && (
          <span className="text-[10px] text-gray-600 font-mono">
            · {fileCount} files
          </span>
        )}
        <span className={`
          ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
          rounded ${RISK_BADGE[step.risk_level]}
        `}>
          {step.risk_level} risk
        </span>
        {focused && (
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-gray-600 font-mono ml-1">
            <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700">a</kbd>
            <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700">r</kbd>
          </span>
        )}
      </div>

      {/* ── [2] HIGH RISK banner — visible at list-scan level ──────────── */}
      {isHighRisk && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-950/30 border-b border-red-900/30">
          <span className="text-red-400 text-xs">⚠</span>
          <span className="text-xs font-semibold text-red-400">HIGH RISK</span>
          <span className="text-xs text-red-400/60">
            {step.action_type === "delete"
              ? "— permanent, cannot be undone without version control"
              : "— affects configuration or shared infrastructure"}
          </span>
        </div>
      )}
      {isMedium && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/15">
          <span className="text-amber-300 text-xs">△</span>
          <span className="text-xs text-amber-300">
            Review downstream references before approving
          </span>
        </div>
      )}

      <div className="px-4 py-4 space-y-4">

        {/* ── File ──────────────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">
            {multiFile ? "Primary file" : "File"}
          </p>
          <code className="text-sm font-mono text-cyan-300">{step.file_path}</code>
        </div>

        {/* ── SYSTEM WILL ────────────────────────────────────────── */}
        <div className="rounded-lg border border-gray-800 bg-gray-950/60 overflow-hidden">
          {/* Section header — clickable to collapse when many files */}
          <button
            type="button"
            onClick={() => setChangesOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2
                       border-b border-gray-800 bg-gray-900/60 text-left"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              SYSTEM WILL
              {/* [1] File count in section header for multi-file steps */}
              {multiFile && (
                <span className="ml-2 normal-case font-normal text-gray-600">
                  · {fileCount} {fileCount === 1 ? "file" : "files"}
                </span>
              )}
            </p>
            {multiFile && (
              <span className="text-[10px] text-gray-700">
                {changesOpen ? "▲" : "▼"}
              </span>
            )}
          </button>

          {changesOpen && (
            <div className="px-3 py-3 space-y-2">
              <p className="text-sm text-gray-200 font-medium leading-snug">
                {step.system_will.summary}
              </p>

              {/* [1] File list — structured, limited at 4, show-more for the rest */}
              {fileCount > 0 && (
                <ul className="space-y-1.5 pt-1 border-t border-gray-800/60">
                  {visibleFiles.map((c, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <span className="text-gray-600 font-mono shrink-0 mt-0.5">→</span>
                      <span className="min-w-0">
                        <code className="text-cyan-400 font-mono truncate block">{c.file}</code>
                        <span className="text-gray-600">{c.details}</span>
                      </span>
                    </li>
                  ))}
                  {/* "...and N more" toggle */}
                  {hiddenCount > 0 && !showAllFiles && (
                    <li>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setShowAllFiles(true); }}
                        className="text-[11px] text-gray-600 hover:text-gray-400
                                   transition-colors font-mono pl-4"
                      >
                        ...and {hiddenCount} more file{hiddenCount > 1 ? "s" : ""}
                      </button>
                    </li>
                  )}
                  {showAllFiles && hiddenCount > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setShowAllFiles(false); }}
                        className="text-[11px] text-gray-600 hover:text-gray-400
                                   transition-colors font-mono pl-4"
                      >
                        show less
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── IMPACT ────────────────────────────────────────────── */}
        {step.system_will.impact.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-2">
              Impact
            </p>
            <ul className="space-y-1">
              {step.system_will.impact.map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-400 leading-relaxed">
                  <span className="text-gray-600 shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── RISK NOTES ───────────────────────────────────────── */}
        {step.system_will.risk_notes.length > 0 && (
          <div className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed space-y-1
            ${isHighRisk
              ? "bg-red-500/10 text-red-300"
              : "bg-amber-500/10 text-amber-300"}`}>
            {step.system_will.risk_notes.map((note, i) => (
              <p key={i} className="flex gap-1.5">
                <span className="shrink-0">⚠</span>{note}
              </p>
            ))}
          </div>
        )}

        {/* ── WHY — collapsible, pre-expanded for high risk ─── */}
        <div>
          <button
            type="button"
            onClick={() => setWhyOpen(o => !o)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase
                       tracking-wider text-gray-600 hover:text-gray-400 transition-colors"
          >
            <span className={`transition-transform duration-150 ${whyOpen ? "rotate-90" : ""}`}>
              ▶
            </span>
            Why this step
            {isHighRisk && !whyOpen && (
              <span className="ml-1 text-red-500/60 normal-case font-normal">
                — read before approving
              </span>
            )}
          </button>
          {whyOpen && (
            <div className="mt-2 pl-3 border-l border-gray-800">
              {step.why_explanation.split("\n\n").map((para, i) => (
                <p key={i} className={`text-xs leading-relaxed mb-1 last:mb-0
                  ${i === 0 ? "text-gray-500 italic" : "text-gray-400"}`}>
                  {para}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Approve / Reject ────────────────────────────────────── */}
      {/* HIGH risk: stacked layout with extra vertical gap — physical distance
          between buttons forces a deliberate second movement after reading.
          LOW/MEDIUM: side-by-side for speed. */}
      <div className={`px-4 pb-4 ${isHighRisk ? "flex flex-col gap-3" : "flex gap-2.5"}`}>
        <button
          type="button"
          disabled={pending}
          onClick={() => void decide("approved")}
          className={`
            rounded-lg text-sm font-bold transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed
            ${isHighRisk
              ? "w-full py-3.5 text-white bg-red-700 hover:bg-red-600 border border-red-600"
              : "flex-1 py-2.5 text-gray-950 bg-emerald-400 hover:bg-emerald-300"}
          `}
        >
          {pending ? "…" : isHighRisk ? "Approve (high risk)" : "Approve"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void decide("rejected")}
          className={`
            rounded-lg text-sm font-bold text-gray-300 transition-colors
            bg-gray-800 hover:bg-gray-700 border border-gray-700
            disabled:opacity-50 disabled:cursor-not-allowed
            ${isHighRisk ? "w-full py-3" : "flex-1 py-2.5"}
          `}
        >
          {pending ? "…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
