/**
 * Phase 11E — Workflow Builder Entry
 *
 * Authoring surface for assembling a WorkflowSpec from typed input.
 *
 * Product rule (locked):
 *   WorkflowBuilder is an authoring surface, not an interpreter.
 *   - It collects strings.
 *   - It assembles WorkflowSpec.
 *   - It does not validate intent beyond basic field completeness.
 *   - It does not preview execution semantics.
 *   - It does not auto-rewrite tasks.
 */

import { useState, useId, useEffect, useRef, useMemo } from "react";
import { Button }           from "../ui/Button.js";
import { Badge }            from "../ui/Badge.js";
import type { WorkflowSpec, WorkflowTaskSpec, ProviderStatus } from "../../api/types.js";
import type { StartOpts }   from "../../hooks/useWorkflowRun.js";
import { WORKFLOW_TEMPLATES } from "../../data/templates.js";
import { guessParseable, suggestRewrite, RECOVERY_FORMATS } from "../../helpers/intent.js";
import { getProviderStatus } from "../../api/client.js";

// ─── Internal draft types ─────────────────────────────────────────────────────

type DraftTask = {
  id:          string;
  input:       string;
  label:       string;
  runtime:     "cursor" | "claude";
  targetFiles: string;
};

function emptyTask(id: string): DraftTask {
  return { id, input: "", label: "", runtime: "cursor", targetFiles: "" };
}

function parseDraftTask(draft: DraftTask): WorkflowTaskSpec {
  const files = draft.targetFiles
    .split(",")
    .map(f => f.trim())
    .filter(Boolean);
  return {
    input:        draft.input.trim(),
    ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
    runtime:      draft.runtime,
    ...(files.length > 0 ? { targetFiles: files } : {}),
  };
}

function isTaskComplete(draft: DraftTask): boolean {
  return draft.input.trim().length > 0;
}

// ─── Runtime selector ─────────────────────────────────────────────────────────

const RUNTIME_META = {
  cursor: {
    label: "Local edit",
    tip:   "Runs changes directly in your local project files. No external app required.",
  },
  claude: {
    label: "Claude",
    tip:   "Sends the approved task to Claude's runtime after approval. Best for complex or reasoning-heavy tasks.",
  },
} as const;

function RuntimeSelector({
  value,
  onChange,
}: {
  value:    "cursor" | "claude";
  onChange: (v: "cursor" | "claude") => void;
}) {
  return (
    <div className="flex gap-1">
      {(["cursor", "claude"] as const).map(rt => (
        <div key={rt} className="group relative">
          <button
            type="button"
            onClick={() => onChange(rt)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
              ${value === rt
                ? "bg-[#00D4FF]/10 text-[#00D4FF] ring-1 ring-[#00D4FF]/25"
                : "text-gray-600 hover:text-gray-400 hover:bg-gray-800/60"
              }`}
          >
            {RUNTIME_META[rt].label}
          </button>
          {/* Tooltip */}
          <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2
                          mb-2 w-44 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2
                          opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-xl">
            <p className="text-[11px] font-semibold text-gray-200 mb-0.5">
              {RUNTIME_META[rt].label}
            </p>
            <p className="text-[10px] text-gray-400 leading-snug">
              {RUNTIME_META[rt].tip}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Scope (target files) input ───────────────────────────────────────────────

function ScopeInput({
  value,
  onChange,
}: {
  value:    string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fileCount = value.split(",").filter(f => f.trim()).length;

  return (
    <div className="border-t border-gray-800/70">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left
                   hover:bg-gray-800/20 transition-colors rounded-b-xl"
      >
        <span className={`text-[10px] font-semibold uppercase tracking-wider
          ${fileCount > 0 ? "text-[#00D4FF]/80" : "text-gray-600"}`}>
          Scope (optional)
        </span>
        {fileCount > 0 && (
          <Badge label={`${fileCount} file${fileCount > 1 ? "s" : ""}`} variant="reviewing" />
        )}
        <span className="ml-auto text-gray-700 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="src/Button.tsx, src/styles/globals.css"
            className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg
                       px-3 py-2 text-base font-mono text-gray-200
                       placeholder:text-gray-600 placeholder:font-sans
                       focus:outline-none focus:border-[#00D4FF]/60
                       focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
          />
          <p className="text-[10px] text-gray-600 leading-snug">
            Specify files to avoid scope questions during execution.
            Comma-separated.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

type TaskRowProps = {
  draft:      DraftTask;
  index:      number;
  total:      number;
  onChange:   (id: string, patch: Partial<DraftTask>) => void;
  onRemove:   (id: string) => void;
  onMoveUp:   (id: string) => void;
  onMoveDown: (id: string) => void;
  /** True when this cursor task's input doesn't match any supported pattern */
  unparseable?: boolean;
};

function TaskRow({ draft, index, total, onChange, onRemove, onMoveUp, onMoveDown, unparseable }: TaskRowProps) {
  const inputId = useId();
  const empty   = !isTaskComplete(draft);
  const suggestion = unparseable ? suggestRewrite(draft.input) : null;

  return (
    <div className={`rounded-xl border bg-gray-900 transition-colors
      ${empty ? "border-gray-800" : "border-gray-700/80"}`}
    >
      {/* Row header: number · label · runtime · reorder/remove */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="w-5 h-5 rounded-full bg-gray-800 text-gray-500
                         flex items-center justify-center text-[10px] font-mono
                         font-bold flex-none">
          {index + 1}
        </span>

        <input
          type="text"
          value={draft.label}
          onChange={e => onChange(draft.id, { label: e.target.value })}
          placeholder={`Optional label (e.g. "Update button color")`}
          className="flex-1 bg-transparent text-base text-gray-300
                     placeholder:text-gray-600 focus:outline-none"
        />

        <RuntimeSelector
          value={draft.runtime}
          onChange={v => onChange(draft.id, { runtime: v })}
        />

        <div className="flex gap-0.5 flex-none ml-1">
          <button type="button" onClick={() => onMoveUp(draft.id)} disabled={index === 0}
            title="Move up"
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1
                       text-gray-700 hover:text-gray-400 disabled:opacity-20
                       disabled:cursor-not-allowed rounded transition-colors text-sm
                       flex items-center justify-center">
            ↑
          </button>
          <button type="button" onClick={() => onMoveDown(draft.id)} disabled={index === total - 1}
            title="Move down"
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1
                       text-gray-700 hover:text-gray-400 disabled:opacity-20
                       disabled:cursor-not-allowed rounded transition-colors text-sm
                       flex items-center justify-center">
            ↓
          </button>
          <button type="button" onClick={() => onRemove(draft.id)} title="Remove"
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1
                       text-gray-700 hover:text-red-400 rounded transition-colors text-sm
                       flex items-center justify-center">
            ✕
          </button>
        </div>
      </div>

      {/* Label helper */}
      {draft.label && (
        <p className="px-4 pb-1 text-[10px] text-gray-600">
          Used in review and history
        </p>
      )}

      {/* Main instruction input */}
      <div className="px-4 pb-1">
        <label htmlFor={inputId} className="sr-only">Task instruction</label>
        <textarea
          id={inputId}
          value={draft.input}
          onChange={e => onChange(draft.id, { input: e.target.value })}
          placeholder={`replace "bg-blue-500" with "bg-indigo-600" in src/components/Button.tsx`}
          rows={2}
          className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg
                     px-3 py-2 text-base font-mono text-gray-100 resize-none
                     placeholder:text-gray-600 placeholder:font-sans placeholder:text-sm
                     focus:outline-none focus:border-[#00D4FF]/60
                     focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
        />
        <p className="text-[10px] text-gray-600 mt-1 leading-snug">
          Write this like a Cursor prompt — one clear change per step
        </p>
      </div>

      {/* Pre-flight gate — #160: cursor task that doesn't match any supported
          pattern. This step now blocks the workflow from starting (not just
          a warning that gets skipped at runtime). Per-row rewrite guidance
          is preserved so the user has a one-click path to unblock. */}
      {unparseable && (
        <div
          role="alert"
          aria-live="polite"
          className="mx-4 mb-3 rounded-lg border border-red-700/60 bg-red-950/30 px-3 py-2.5"
        >
          <p className="text-[10px] uppercase tracking-wider font-bold text-red-400 mb-1.5 tracking-widest">
            Step not supported
          </p>
          <p className="text-[11px] text-red-300/90 leading-snug mb-2">
            This step doesn't match a supported format. Rewrite it or switch runtime to
            <strong className="text-red-300"> Claude</strong> before starting — the workflow
            cannot start while this step remains as-is.
          </p>
          {suggestion ? (
            <div className="mb-2">
              <p className="text-[10px] text-red-400/90 uppercase tracking-wider font-semibold mb-1">
                Suggested rewrite
              </p>
              <button
                type="button"
                onClick={() => onChange(draft.id, { input: suggestion })}
                className="w-full text-left font-mono text-[11px] text-[#00D4FF]/90
                           bg-zinc-950 border border-[#00D4FF]/20 rounded-lg px-2.5 py-2
                           hover:border-[#00D4FF]/50 hover:bg-[#00D4FF]/5 transition-colors"
              >
                {suggestion}
                <span className="block text-[9px] text-[#00D4FF]/40 mt-1 font-sans">
                  Click to use this rewrite
                </span>
              </button>
            </div>
          ) : (
            <div className="mb-1">
              <p className="text-[10px] text-red-400/80 mb-1">Supported formats:</p>
              <ul className="flex flex-col gap-0.5">
                {RECOVERY_FORMATS.map(f => (
                  <li key={f}
                      onClick={() => onChange(draft.id, { input: f })}
                      className="font-mono text-[10px] text-red-400/80 cursor-pointer
                                 hover:text-[#00D4FF]/80 transition-colors">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-red-500/70 leading-snug">
            Switching runtime to <strong className="text-red-400">Claude</strong> handles open-ended steps without a structured format.
          </p>
        </div>
      )}

      <div className="px-0 pb-0">
        <ScopeInput
          value={draft.targetFiles}
          onChange={v => onChange(draft.id, { targetFiles: v })}
        />
      </div>
    </div>
  );
}

// ─── Recent paths (localStorage) ─────────────────────────────────────────────

const RECENT_KEY = "usesteady:recent-paths";
const MAX_RECENT = 5;

export function getRecentPaths(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function saveRecentPath(p: string): void {
  const trimmed = p.trim();
  if (!trimmed) return;
  const existing = getRecentPaths().filter(r => r !== trimmed);
  localStorage.setItem(RECENT_KEY, JSON.stringify([trimmed, ...existing].slice(0, MAX_RECENT)));
}

function folderName(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? p;
}

// ─── Workspace picker ─────────────────────────────────────────────────────────

type WorkspaceMode = "select" | "manual" | "create" | "clone";

export function WorkspacePicker({
  value,
  onChange,
}: {
  value:    string;
  onChange: (v: string) => void;
}) {
  const [mode,      setMode]      = useState<WorkspaceMode>("select");
  const [recents,   setRecents]   = useState<string[]>([]);
  const [autoPath,  setAutoPath]  = useState<string | null>(null);
  const [autoHasGit, setAutoHasGit] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createParent, setCreateParent] = useState("");
  const [cloneUrl,  setCloneUrl]  = useState("");
  const [cloneParent, setCloneParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filled = value.trim().length > 0;

  useEffect(() => {
    setRecents(getRecentPaths());
    // Auto-detect server cwd + git status on mount
    fetch("/api/cwd")
      .then(r => r.json())
      .then((d: { cwd: string; hasGit?: boolean }) => {
        setAutoPath(d.cwd);
        setAutoHasGit(d.hasGit ?? false);
      })
      .catch(() => {/* server not available yet */});
  }, []);

  function select(path: string) {
    onChange(path);
    setMode("select");
    setErr("");
  }

  async function handleCreate() {
    if (!createName.trim() || !createParent.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/workspace/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), parentPath: createParent.trim() }),
      });
      const data = await res.json() as { path?: string; error?: string };
      if (!res.ok) { setErr(data.error ?? "Failed to create project."); return; }
      select(data.path!);
    } catch { setErr("Could not reach the server."); }
    finally { setBusy(false); }
  }

  async function handleClone() {
    if (!cloneUrl.trim() || !cloneParent.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/workspace/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: cloneUrl.trim(), parentPath: cloneParent.trim() }),
      });
      const data = await res.json() as { path?: string; error?: string };
      if (!res.ok) { setErr(data.error ?? "Clone failed."); return; }
      select(data.path!);
    } catch { setErr("Could not reach the server."); }
    finally { setBusy(false); }
  }

  // ── Confirmed state ───────────────────────────────────────────────────────
  if (filled && mode === "select") {
    const isRecent   = recents.includes(value.trim());
    const isCurrent  = autoPath !== null && value.trim() === autoPath;
    const sourceLabel = isRecent && !isCurrent ? "Last used" : isCurrent ? "Current folder" : null;

    return (
      <div className="rounded-xl border-2 border-emerald-700/60 bg-emerald-950/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            Workspace
          </p>
          {sourceLabel && (
            <span className="px-2 py-0.5 rounded text-[9px] font-semibold
                             bg-emerald-900/50 text-emerald-500 border border-emerald-800/50
                             leading-none tracking-wide">
              {sourceLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-900/40 flex items-center justify-center text-base flex-none">
            📁
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-300 truncate leading-tight">
              {folderName(value.trim())}
            </p>
            <p className="text-[11px] font-mono text-emerald-800 truncate mt-0.5">{value.trim()}</p>
          </div>
          <button type="button" onClick={() => { onChange(""); setMode("select"); }}
            className="text-[10px] text-gray-600 hover:text-gray-300 flex-none
                       px-2 py-1 rounded-md hover:bg-gray-800 transition-colors">
            change
          </button>
        </div>
        <p className="text-[11px] text-emerald-900 mt-2 leading-snug">
          All steps will run inside this folder only.
        </p>
      </div>
    );
  }

  // ── Create new project form ───────────────────────────────────────────────
  if (mode === "create") {
    return (
      <div className="rounded-xl border-2 border-gray-700 bg-gray-900/60 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMode("select")}
            className="text-gray-600 hover:text-gray-300 text-xs transition-colors">← back</button>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            Create new project
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
            placeholder="Project name  (e.g. my-app)"
            className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2
                       text-base text-gray-200 placeholder:text-gray-600
                       focus:outline-none focus:border-[#00D4FF]/60 focus:ring-1 focus:ring-[#00D4FF]/20" />
          <input type="text" value={createParent} onChange={e => setCreateParent(e.target.value)}
            placeholder={`Parent folder  (e.g. ${autoPath ?? "C:\\Projects"})`}
            className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2
                       text-base font-mono text-gray-200 placeholder:text-gray-600
                       focus:outline-none focus:border-[#00D4FF]/60 focus:ring-1 focus:ring-[#00D4FF]/20" />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button type="button" onClick={handleCreate} disabled={busy || !createName.trim() || !createParent.trim()}
          className="self-start px-4 py-2 rounded-lg bg-[#00D4FF] text-gray-950 text-sm font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
          {busy ? "Creating…" : "Create folder"}
        </button>
      </div>
    );
  }

  // ── Clone from Git form ───────────────────────────────────────────────────
  if (mode === "clone") {
    return (
      <div className="rounded-xl border-2 border-gray-700 bg-gray-900/60 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMode("select")}
            className="text-gray-600 hover:text-gray-300 text-xs transition-colors">← back</button>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            Clone from Git
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <input type="text" value={cloneUrl} onChange={e => setCloneUrl(e.target.value)}
            placeholder="Repository URL  (e.g. https://github.com/user/repo)"
            className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2
                       text-base font-mono text-gray-200 placeholder:text-gray-600 placeholder:font-sans
                       focus:outline-none focus:border-[#00D4FF]/60 focus:ring-1 focus:ring-[#00D4FF]/20" />
          <input type="text" value={cloneParent} onChange={e => setCloneParent(e.target.value)}
            placeholder={`Clone into  (e.g. ${autoPath ?? "C:\\Projects"})`}
            className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2
                       text-base font-mono text-gray-200 placeholder:text-gray-600
                       focus:outline-none focus:border-[#00D4FF]/60 focus:ring-1 focus:ring-[#00D4FF]/20" />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button type="button" onClick={handleClone} disabled={busy || !cloneUrl.trim() || !cloneParent.trim()}
          className="self-start px-4 py-2 rounded-lg bg-[#00D4FF] text-gray-950 text-sm font-semibold
                     disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
          {busy ? "Cloning…" : "Clone repo"}
        </button>
      </div>
    );
  }

  // ── Manual path input ─────────────────────────────────────────────────────
  if (mode === "manual") {
    return (
      <div className="rounded-xl border-2 border-gray-700 bg-gray-900/60 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMode("select")}
            className="text-gray-600 hover:text-gray-300 text-xs transition-colors">← back</button>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            Enter path
          </p>
        </div>
        <input ref={inputRef} type="text" value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { if (value.trim()) setMode("select"); }}
          placeholder="e.g. C:\Forge  or  /Users/you/my-project"
          autoFocus
          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2.5
                     text-base font-mono text-gray-200 placeholder:text-gray-600 placeholder:font-sans
                     focus:outline-none focus:border-[#00D4FF]/60 focus:ring-1 focus:ring-[#00D4FF]/20" />
        <p className="text-[11px] text-gray-600 leading-snug">
          Paste the full path from File Explorer or Finder.
        </p>
      </div>
    );
  }

  // ── Selection state (default) ─────────────────────────────────────────────
  return (
    <div className="rounded-xl border-2 border-gray-700 bg-gray-900/60 p-4 flex flex-col gap-3">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
        Where should this run?
      </p>

      {/* Auto-detected current folder */}
      {autoPath && (
        <button type="button" onClick={() => select(autoPath)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     bg-[#00D4FF]/5 border border-[#00D4FF]/20
                     hover:bg-[#00D4FF]/10 hover:border-[#00D4FF]/40
                     hover:-translate-y-0.5 hover:shadow-md hover:shadow-[#00D4FF]/10
                     transition-all group">
          <span className="text-base flex-none">📁</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-xs font-semibold text-[#00D4FF]/80">Current folder</p>
              {autoHasGit && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold font-mono
                                 bg-emerald-900/50 text-emerald-400 border border-emerald-800/60
                                 leading-none">
                  git
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-gray-500 truncate">{autoPath}</p>
          </div>
          <span className="text-[10px] text-[#00D4FF]/50 flex-none">use →</span>
        </button>
      )}

      {/* Recent paths */}
      {recents.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-gray-600 font-medium">Recent</p>
          {recents.map(r => (
            <button key={r} type="button"
              onMouseDown={e => { e.preventDefault(); select(r); }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-left
                         bg-gray-800/40 hover:bg-gray-800/70 border border-transparent
                         hover:border-[#00D4FF]/20 transition-all group">
              <span className="text-base flex-none">📁</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-400 truncate leading-tight
                               group-hover:text-[#00D4FF] transition-colors">
                  {folderName(r)}
                </p>
                <p className="text-[10px] font-mono text-gray-600 truncate">{r}</p>
              </div>
              <span className="text-[10px] text-gray-700 group-hover:text-[#00D4FF]/60 flex-none">
                select →
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <button type="button" onClick={() => setMode("manual")}
          className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg
                     bg-gray-800/50 hover:bg-gray-800/80 border border-gray-700/60
                     hover:border-white/[0.12] hover:-translate-y-0.5
                     hover:shadow-md transition-all text-center group">
          <span className="text-lg leading-none group-hover:scale-110 transition-transform">📂</span>
          <span className="text-[10px] font-medium text-gray-400 group-hover:text-gray-200 transition-colors">Enter path</span>
        </button>
        <button type="button" onClick={() => { setCreateParent(autoPath ?? ""); setMode("create"); }}
          className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg
                     bg-gray-800/50 hover:bg-gray-800/80 border border-gray-700/60
                     hover:border-white/[0.12] hover:-translate-y-0.5
                     hover:shadow-md transition-all text-center group">
          <span className="text-lg leading-none group-hover:scale-110 transition-transform">✨</span>
          <span className="text-[10px] font-medium text-gray-400 group-hover:text-gray-200 transition-colors">New project</span>
        </button>
        <button type="button" onClick={() => { setCloneParent(autoPath ?? ""); setMode("clone"); }}
          className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg
                     bg-gray-800/50 hover:bg-gray-800/80 border border-gray-700/60
                     hover:border-white/[0.12] hover:-translate-y-0.5
                     hover:shadow-md transition-all text-center group">
          <span className="text-lg leading-none group-hover:scale-110 transition-transform">⬇️</span>
          <span className="text-[10px] font-medium text-gray-400 group-hover:text-gray-200 transition-colors">Clone Git repo</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main builder ─────────────────────────────────────────────────────────────

type Props = {
  onBuild:          (spec: WorkflowSpec, opts: StartOpts) => void;
  loading?:         boolean;
  /** Pre-fill the first task's input field (set by "Try this" on a SYSTEM SUGGESTS suggestion). */
  initialTaskInput?: string;
};

let nextId = 1;
function uid() { return String(nextId++); }

export function WorkflowBuilder({ onBuild, loading, initialTaskInput }: Props) {
  const [name,             setName]             = useState("");
  const [tasks,            setTasks]            = useState<DraftTask[]>(() => {
    const first = emptyTask(uid());
    if (initialTaskInput?.trim()) first.input = initialTaskInput.trim();
    return [first];
  });
  // Pre-fill from most recent path so returning users skip re-selection
  const [workspaceRoot,    setWorkspaceRoot]    = useState(() => getRecentPaths()[0] ?? "");
  const [breakGlass,       setBreakGlass]       = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState("");

  function addTask() {
    setTasks(ts => [...ts, emptyTask(uid())]);
  }

  function updateTask(id: string, patch: Partial<DraftTask>) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  function removeTask(id: string) {
    setTasks(ts => ts.length > 1 ? ts.filter(t => t.id !== id) : ts);
  }

  function moveTask(id: string, dir: 1 | -1) {
    setTasks(ts => {
      const idx  = ts.findIndex(t => t.id === id);
      if (idx === -1) return ts;
      const next = idx + dir;
      if (next < 0 || next >= ts.length) return ts;
      const copy = [...ts];
      [copy[idx], copy[next]] = [copy[next]!, copy[idx]!];
      return copy;
    });
  }

  const completeTasks      = tasks.filter(isTaskComplete);
  const hasWorkspace       = workspaceRoot.trim().length > 0;
  const hasBreakGlassReason = !breakGlass || breakGlassReason.trim().length > 0;
  const incompleteRows     = tasks.filter(t => !isTaskComplete(t)).length;

  // Pre-flight: which cursor tasks are likely unparseable?
  // Only flag tasks that have content (complete) and runtime=cursor and don't match any pattern.
  // Computed before canStart so the gate can block on unsupported steps — see issue #160.
  const unparseableIds = new Set(
    completeTasks
      .filter(t => t.runtime === "cursor" && !guessParseable(t.input))
      .map(t => t.id)
  );
  const hasUnparseable = unparseableIds.size > 0;

  // ─── #150 credential pre-flight ────────────────────────────────────────────
  //
  // Provider-agnostic credential gate. The server owns all decisions (keys
  // are never sent to the browser); the UI only consumes the presence + live
  // flags to decide: BLOCK vs allow-with-demo-indicator vs silent.
  //
  // State contract:
  //   providerStatus === null → initial load or fetch failed → do NOT block
  //                             (fail-open is the right posture while we don't
  //                              yet know; the CLI guard is the hard stop for
  //                              live execution). The UI guidance layer is a
  //                              convenience, not the only line of defense.
  const [providerStatus, setProviderStatus] = useState<readonly ProviderStatus[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProviderStatus()
      .then(res => { if (!cancelled) setProviderStatus(res.providers); })
      .catch(() => { /* fail-open; CLI remains the hard stop */ });
    return () => { cancelled = true; };
  }, []);

  const requiredProviderIds = useMemo(() => {
    if (!providerStatus) return [] as string[];
    const out = new Set<string>();
    for (const t of completeTasks) {
      for (const p of providerStatus) {
        if (p.runtimes.includes(t.runtime)) out.add(p.id);
      }
    }
    return [...out];
  }, [completeTasks, providerStatus]);

  const missingProviders = useMemo(() => {
    if (!providerStatus) return [] as readonly ProviderStatus[];
    const wanted = new Set(requiredProviderIds);
    return providerStatus.filter(p => wanted.has(p.id) && !p.configured);
  }, [providerStatus, requiredProviderIds]);

  // Split missing by live-mode: live → BLOCK; demo → subtle indicator.
  // Same definition of "live mode" as the CLI (both use isProviderLive on the
  // server; UI receives the flag verbatim in ProviderStatus.liveMode). No
  // divergence is possible — there is one canonical predicate.
  const missingLiveProviders = missingProviders.filter(p => p.liveMode);
  const missingDemoProviders = missingProviders.filter(p => !p.liveMode);
  const hasMissingCredentials = missingLiveProviders.length > 0;
  const hasDemoModeIndicator  = missingDemoProviders.length > 0 && !hasMissingCredentials;

  // Start gate — #160 (unparseable) AND #150 (credentials) both block.
  const canStart = (
    name.trim().length > 0 &&
    completeTasks.length > 0 &&
    hasWorkspace &&
    hasBreakGlassReason &&
    !hasUnparseable &&
    !hasMissingCredentials
  );

  function handleStart() {
    if (!canStart) return;
    // Defense-in-depth for #160: even if canStart is somehow bypassed
    // (keyboard shortcut, programmatic submit, future refactor), never
    // start a workflow containing cursor steps that failed pre-flight.
    if (hasUnparseable) return;
    // Defense-in-depth for #150: same contract for credential gating —
    // live mode + any missing provider must never start from the UI.
    if (hasMissingCredentials) return;
    if (workspaceRoot.trim()) saveRecentPath(workspaceRoot.trim());
    onBuild(
      { name: name.trim(), tasks: completeTasks.map(parseDraftTask) },
      {
        workspaceRoot:    workspaceRoot.trim() || undefined,
        mode:             breakGlass ? "break_glass" : undefined,
        breakGlassReason: breakGlass ? breakGlassReason.trim() : undefined,
      },
    );
  }

  function handleSaveSpec() {
    const spec: WorkflowSpec = {
      name:  name.trim() || "my-workflow",
      tasks: completeTasks.map(parseDraftTask),
    };
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${spec.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Derive the hint shown when start is blocked.
  // #160: hasUnparseable is a hard gate — surfaces last, after the basic
  // prerequisites, since it only triggers once the user has filled out
  // tasks but some cursor steps don't match a supported pattern.
  const startBlockReason = !hasWorkspace
    ? "Select an execution location to continue"
    : breakGlass && !breakGlassReason.trim()
      ? "Enter a reason for break-glass to continue"
      : !name.trim()
        ? "Add a workflow name to continue"
        : completeTasks.length === 0
          ? "Add at least one task to continue"
          : hasUnparseable
            ? "Rewrite or remove unsupported cursor steps to continue"
            : hasMissingCredentials
              ? `Configure ${missingLiveProviders.map(p => p.displayName).join(", ")} to continue`
              : null;

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl">

      {/* ① Break-glass toggle — declared first, before any intent is entered */}
      <div className={`rounded-xl border-2 transition-colors p-4
        ${breakGlass
          ? "border-amber-700/70 bg-amber-950/20"
          : "border-gray-800 bg-transparent"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-300">Break-glass mode</p>
            <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">
              Skips per-step approvals. All steps run immediately after start.
              Full audit record is kept. Reason required.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={breakGlass}
            onClick={() => { setBreakGlass(v => !v); setBreakGlassReason(""); }}
            className={`flex-none w-10 h-6 rounded-full transition-colors relative
              ${breakGlass ? "bg-amber-500" : "bg-gray-700"}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all
              ${breakGlass ? "left-5" : "left-1"}`}
            />
          </button>
        </div>

        {breakGlass && (
          <div className="mt-3 flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-amber-600">
              Reason <span className="text-amber-700">(required)</span>
            </label>
            <textarea
              value={breakGlassReason}
              onChange={e => setBreakGlassReason(e.target.value)}
              placeholder="e.g. Production incident — rolling back auth config to restore service"
              rows={2}
              autoFocus
              className="w-full bg-amber-950/30 border border-amber-800/60 rounded-lg
                         px-3 py-2 text-base text-amber-100 resize-none
                         placeholder:text-amber-900 placeholder:text-sm
                         focus:outline-none focus:border-amber-600
                         focus:ring-1 focus:ring-amber-600/50"
            />
            <p className="text-[10px] text-amber-800 leading-snug">
              This reason is permanently recorded in the audit trail.
            </p>
          </div>
        )}
      </div>

      {/* ② Execution location — first-class, upfront */}
      <WorkspacePicker value={workspaceRoot} onChange={setWorkspaceRoot} />

      {/* ② Workflow name */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold
                           text-gray-600 mb-1.5">
          Workflow
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Update button styles"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg
                     px-3 py-2.5 text-base font-medium text-gray-100
                     placeholder:text-gray-600 placeholder:font-normal
                     focus:outline-none focus:border-[#00D4FF]/60
                     focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
        />
        <p className="text-[10px] text-gray-600 mt-1.5 leading-snug">
          Give this workflow a short name (e.g. "Update button styles")
        </p>
      </div>

      {/* ③ Tasks */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-600">
              Tasks
            </p>
            <p className="text-[10px] text-gray-700 mt-0.5">
              Add steps — one instruction per task
            </p>
          </div>
          <span className="text-[10px] text-gray-700">
            {completeTasks.length} of {tasks.length} ready
          </span>
        </div>

        {/* Template picker — shown only when all tasks are still empty and name is blank */}
        {!name.trim() && tasks.every(t => !t.input.trim() && !t.label.trim()) && (
          <div className="flex flex-col gap-2 pb-1">
            <p className="text-[10px] text-gray-600">
              Start from a template, or type your own steps below:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {WORKFLOW_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setName(tpl.name);
                    setTasks(tpl.tasks.map((t) => ({
                      id:          uid(),
                      input:       t.input,
                      label:       t.label ?? "",
                      runtime:     t.runtime as "cursor" | "claude",
                      targetFiles: "",
                    })));
                  }}
                  className="flex flex-col items-start gap-0.5 text-left rounded-xl
                             border border-gray-800 bg-gray-900/40 px-3 py-2.5
                             hover:border-[#00D4FF]/25 hover:bg-[#00D4FF]/5
                             transition-all duration-100"
                >
                  <span className="text-xs font-semibold text-gray-300">{tpl.label}</span>
                  <span className="text-[10px] text-gray-600 leading-snug">{tpl.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tasks.map((draft, idx) => (
          <TaskRow
            key={draft.id}
            draft={draft}
            index={idx}
            total={tasks.length}
            onChange={updateTask}
            onRemove={removeTask}
            onMoveUp={id => moveTask(id, -1)}
            onMoveDown={id => moveTask(id, 1)}
            unparseable={unparseableIds.has(draft.id)}
          />
        ))}

        <button
          type="button"
          onClick={addTask}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border
                     border-dashed border-gray-800 text-gray-600 text-sm
                     hover:border-[#00D4FF]/30 hover:text-[#00D4FF]/80 hover:bg-[#00D4FF]/3
                     transition-all duration-100"
        >
          <span className="text-base leading-none">+</span>
          Add another step
        </button>
      </div>

      {/* Pre-flight gate — #160: blocks start when cursor steps don't match
          any supported format. Rendered whenever hasUnparseable is true
          (regardless of canStart), since canStart is now false when
          hasUnparseable — the old `&& canStart` condition would hide the
          banner in exactly the cases it needs to appear. */}
      {hasUnparseable && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-700/70 bg-red-950/30 px-4 py-3"
        >
          <p className="text-xs font-semibold text-red-300 mb-1">
            Workflow cannot start — {unparseableIds.size === 1 ? "1 unsupported step" : `${unparseableIds.size} unsupported steps`}
          </p>
          <p className="text-[11px] text-red-300/90 leading-snug mb-2">
            The highlighted cursor steps don't match a supported format and cannot be
            executed deterministically. Rewrite them using the per-step suggestions,
            remove them, or switch them to <strong>Claude</strong> runtime.
          </p>
          <p className="text-[10px] text-red-400/80">
            Workflow cannot start until every cursor step matches a supported format.
          </p>
        </div>
      )}

      {/* Pre-flight gate — #150: blocks start when a required AI provider is
          in live mode and its API key is missing. Rendered whenever
          hasMissingCredentials is true. Same RED blocking severity as #160
          — we are telling the user the workflow cannot run, not that it
          might. Matches the explain-before-block philosophy. */}
      {hasMissingCredentials && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-700/70 bg-red-950/30 px-4 py-3"
        >
          <p className="text-xs font-semibold text-red-300 mb-1">
            Workflow cannot start — missing API key for {missingLiveProviders.length === 1
              ? missingLiveProviders[0]!.displayName
              : `${missingLiveProviders.length} providers`}
          </p>
          <p className="text-[11px] text-red-300/90 leading-snug mb-2">
            This workflow includes tasks that require a live API call, but the
            credential is not configured.
          </p>
          <ul className="text-[11px] text-red-300/90 leading-snug mb-2 pl-4 list-disc">
            {missingLiveProviders.map(p => (
              <li key={p.id}>
                <strong>{p.displayName}</strong> — set{" "}
                <code className="px-1 py-0.5 rounded bg-red-900/40 text-red-200">
                  {p.envKey}
                </code>
                {p.setupUrl ? (
                  <>
                    {" "}·{" "}
                    <a
                      href={p.setupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-red-200"
                    >
                      Learn how to set this up
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-red-400/80">
            Workflow cannot start until every required provider is configured.
          </p>
        </div>
      )}

      {/* Demo-mode indicator — #150: non-blocking, informational only.
          Shown when a required provider's key is missing AND live mode is
          OFF (so stub / demo execution is the current path). Prevents the
          silent-confusion failure mode where the user thinks AI ran but it
          didn't. Amber tone signals "heads up", not "stop". */}
      {hasDemoModeIndicator && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-800/60 bg-amber-950/20 px-4 py-2.5"
        >
          <p className="text-[11px] text-amber-300/90 leading-snug">
            <strong>Running in demo mode</strong> — no API key configured for{" "}
            {missingDemoProviders.map(p => p.displayName).join(", ")}. Tasks will
            use stub output, not live AI.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-3">
          <Button
            label="Start workflow"
            variant="primary"
            size="lg"
            onClick={handleStart}
            disabled={!canStart}
            loading={loading}
            title={
              hasUnparseable
                ? "Rewrite or remove unsupported cursor steps to start"
                : hasMissingCredentials
                  ? `Configure ${missingLiveProviders.map(p => p.displayName).join(", ")} to start`
                  : undefined
            }
            ariaLabel={
              hasUnparseable
                ? "Start workflow — disabled until unsupported cursor steps are rewritten or removed"
                : hasMissingCredentials
                  ? `Start workflow — disabled until ${missingLiveProviders.map(p => p.displayName).join(", ")} API key is configured`
                  : undefined
            }
          />

          {completeTasks.length > 0 && name.trim() && (
            <Button
              label="Save as JSON"
              variant="ghost"
              size="lg"
              onClick={handleSaveSpec}
            />
          )}
        </div>

        {/* Gate reason or skip count — only one shown at a time */}
        {startBlockReason ? (
          <p className="text-xs text-gray-600">{startBlockReason}</p>
        ) : incompleteRows > 0 ? (
          <p className="text-xs text-gray-600">
            {incompleteRows} empty row{incompleteRows > 1 ? "s" : ""} will be skipped
          </p>
        ) : null}
      </div>
    </div>
  );
}
