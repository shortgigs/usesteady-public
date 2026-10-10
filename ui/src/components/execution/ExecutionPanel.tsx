/**
 * Execution review panel — keyboard navigation, progress tracking,
 * concurrency safety, and observability hooks.
 *
 * Keyboard model:
 *   j / ↓   → move focus to next step
 *   k / ↑   → move focus to previous step
 *   a       → approve focused step
 *   r       → reject focused step
 *
 * Concurrency safety:
 *   On tab regain (visibilitychange + window focus), steps are refetched
 *   from the server. If any step's status differs from local state, a
 *   dismissible notice appears: "Plan updated in another tab."
 *   Local state is reconciled to server state (last-write-wins).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ExecutionStep } from "../../api/types.js";
import { getSessionSteps, undoLastApproval, recordStepDecision } from "../../api/client.js";
import { ExecutionStepCard } from "./ExecutionStepCard.js";
import { SessionTimeline } from "./SessionTimeline.js";

// ─── Mock (development / demo — fallback when no sessionId) ──────────────────

/**
 * 20-step stress-test fixture — validates keyboard nav, collapse, and progress
 * at realistic scale. Covers: low / medium / high risk, all action types,
 * single-file and multi-file steps.
 */
const MOCK_STEPS: ExecutionStep[] = [
  {
    id: "m1", file_path: "src/components/Button.tsx", action_type: "update",
    system_will: {
      summary: "Apply text replacement in: src/components/Button.tsx",
      changes: [{ file: "src/components/Button.tsx", details: "Replace bg-blue-500 → bg-indigo-600" }],
      impact: ["In-place text replacement — review exact diff before approving."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"change the button color to indigo\"\n\nThe system will replace the Tailwind background class in src/components/Button.tsx.",
    status: "pending",
  },
  {
    id: "m2", file_path: "src/components/Header.tsx", action_type: "create",
    system_will: {
      summary: "Create new file: src/components/Header.tsx",
      changes: [{ file: "src/components/Header.tsx", details: "Write new component content" }],
      impact: ["New file — no existing behaviour changed."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add a sticky header component\"\n\nThe system will create src/components/Header.tsx with the new component.",
    status: "pending",
  },
  {
    id: "m3", file_path: "package.json", action_type: "update",
    system_will: {
      summary: "Modify package.json to add lodash dependency",
      changes: [{ file: "package.json", details: "Add lodash to dependencies block" }],
      impact: [
        "Dependency manifest changed — run npm install after this step.",
        "Affects the entire project build.",
      ],
      risk_notes: ["Dependency changes can introduce version conflicts — verify lock file after apply."],
    },
    risk_level: "high",
    why_explanation: "You asked: \"add lodash as a dependency\"\n\nThe system will add lodash to package.json. npm install must be run manually after approval.",
    status: "pending",
  },
  {
    id: "m4", file_path: "src/utils/deprecated.ts", action_type: "delete",
    system_will: {
      summary: "Permanently delete: src/utils/deprecated.ts",
      changes: [{ file: "src/utils/deprecated.ts", details: "File will be removed from disk" }],
      impact: ["File permanently removed — any import of this module will break.", "Cannot be undone without version control."],
      risk_notes: ["Deleting a source file is irreversible outside of git. Verify no active imports remain."],
    },
    risk_level: "high",
    why_explanation: "You asked: \"remove the deprecated utility module\"\n\nThe system will permanently delete src/utils/deprecated.ts from disk.",
    status: "pending",
  },
  {
    id: "m5", file_path: "src/components/Icon.tsx", action_type: "rename",
    system_will: {
      summary: "Rename Icon.tsx → IconBase.tsx",
      changes: [
        { file: "src/components/Icon.tsx", details: "Remove original file" },
        { file: "src/components/IconBase.tsx", details: "Write renamed content" },
      ],
      impact: ["All existing imports of Icon.tsx must be updated.", "If missed, TypeScript will throw on build."],
      risk_notes: ["Check barrel exports and index files before approving."],
    },
    risk_level: "medium",
    why_explanation: "You asked: \"rename Icon to IconBase for clarity\"\n\nThe system will rename the file and create a new one. Existing imports are not automatically updated.",
    status: "pending",
  },
  {
    id: "m6", file_path: "src/hooks/useTheme.ts", action_type: "create",
    system_will: {
      summary: "Create new file: src/hooks/useTheme.ts",
      changes: [{ file: "src/hooks/useTheme.ts", details: "Write custom hook" }],
      impact: ["New hook — no existing behaviour changed."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add a useTheme hook\"\n\nThe system will create src/hooks/useTheme.ts with the new hook implementation.",
    status: "pending",
  },
  {
    id: "m7", file_path: "src/components/Card.tsx", action_type: "update",
    system_will: {
      summary: "Update Card.tsx — apply layout refactor across 3 files",
      changes: [
        { file: "src/components/Card.tsx",        details: "Refactor padding and grid layout" },
        { file: "src/components/CardHeader.tsx",  details: "Update header margin" },
        { file: "src/components/CardFooter.tsx",  details: "Align footer flex direction" },
      ],
      impact: ["Layout change — visual regression test recommended.", "3 files modified in a single step."],
      risk_notes: [],
    },
    risk_level: "medium",
    why_explanation: "You asked: \"refactor the card layout for consistent padding\"\n\nThe system will update Card.tsx and its sub-components.",
    status: "pending",
  },
  {
    id: "m8", file_path: "src/tests/Button.test.tsx", action_type: "create",
    system_will: {
      summary: "Create new test file: src/tests/Button.test.tsx",
      changes: [{ file: "src/tests/Button.test.tsx", details: "Write Vitest unit tests" }],
      impact: ["New test file — no production code affected."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add unit tests for Button\"\n\nThe system will create a Vitest test file for the Button component.",
    status: "pending",
  },
  {
    id: "m9", file_path: ".env.local", action_type: "update",
    system_will: {
      summary: "Modify .env.local — update environment variable",
      changes: [{ file: ".env.local", details: "Set NEXT_PUBLIC_API_URL" }],
      impact: ["Environment variable change — affects runtime config.", "Do not commit this file."],
      risk_notes: ["Env files may contain secrets — never commit after editing."],
    },
    risk_level: "high",
    why_explanation: "You asked: \"update the API base URL in local env\"\n\nThe system will modify .env.local. Ensure this file is in .gitignore.",
    status: "pending",
  },
  {
    id: "m10", file_path: "src/components/Modal.tsx", action_type: "update",
    system_will: {
      summary: "Apply accessibility improvements in 5 files",
      changes: [
        { file: "src/components/Modal.tsx",   details: "Add aria-modal and role=dialog" },
        { file: "src/components/Drawer.tsx",  details: "Add aria-label" },
        { file: "src/components/Tooltip.tsx", details: "Add aria-describedby" },
        { file: "src/components/Popover.tsx", details: "Add focus trap" },
        { file: "src/components/Dialog.tsx",  details: "Add role=alertdialog" },
      ],
      impact: ["Accessibility improvement — no visual change.", "Screen reader behaviour will change."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add proper ARIA attributes to overlay components\"\n\nThe system will update 5 overlay components with accessibility attributes.",
    status: "pending",
  },
  {
    id: "m11", file_path: "src/services/api.ts", action_type: "update",
    system_will: {
      summary: "Modify api.ts — add retry logic",
      changes: [{ file: "src/services/api.ts", details: "Wrap fetch calls with exponential backoff" }],
      impact: ["Network requests will now retry up to 3 times on failure.", "May increase perceived latency on slow connections."],
      risk_notes: [],
    },
    risk_level: "medium",
    why_explanation: "You asked: \"add retry logic to API calls\"\n\nThe system will add exponential backoff to all fetch calls in src/services/api.ts.",
    status: "pending",
  },
  {
    id: "m12", file_path: "src/store/userSlice.ts", action_type: "create",
    system_will: {
      summary: "Create new file: src/store/userSlice.ts",
      changes: [{ file: "src/store/userSlice.ts", details: "Write Redux Toolkit user slice" }],
      impact: ["New store module — no existing state affected."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add user state management slice\"\n\nThe system will create a Redux Toolkit slice for user state.",
    status: "pending",
  },
  {
    id: "m13", file_path: "tsconfig.json", action_type: "update",
    system_will: {
      summary: "Modify tsconfig.json — enable strict mode",
      changes: [{ file: "tsconfig.json", details: "Set strict: true in compilerOptions" }],
      impact: ["Strict TypeScript mode enabled — build may surface previously hidden type errors.", "Recommended to fix any errors before merging."],
      risk_notes: ["TypeScript config changes affect the entire project — run tsc --noEmit before continuing."],
    },
    risk_level: "high",
    why_explanation: "You asked: \"enable TypeScript strict mode\"\n\nThe system will add strict: true to tsconfig.json. Expect build errors to surface if the codebase has latent type issues.",
    status: "pending",
  },
  {
    id: "m14", file_path: "src/components/Avatar.tsx", action_type: "rename",
    system_will: {
      summary: "Rename Avatar.tsx → UserAvatar.tsx",
      changes: [
        { file: "src/components/Avatar.tsx",     details: "Remove original file" },
        { file: "src/components/UserAvatar.tsx", details: "Write renamed content" },
      ],
      impact: ["All imports of Avatar must be updated to UserAvatar.", "TypeScript will error on stale imports."],
      risk_notes: [],
    },
    risk_level: "medium",
    why_explanation: "You asked: \"rename Avatar to UserAvatar for clarity\"\n\nThe system will rename the file. Imports will not be automatically updated.",
    status: "pending",
  },
  {
    id: "m15", file_path: "src/utils/format.ts", action_type: "delete",
    system_will: {
      summary: "Permanently delete: src/utils/format.ts",
      changes: [{ file: "src/utils/format.ts", details: "File will be removed from disk" }],
      impact: ["Permanently removes format utilities.", "Any code importing from this file will fail at build time."],
      risk_notes: ["Verify no remaining imports before approving — deletion is permanent outside of git."],
    },
    risk_level: "high",
    why_explanation: "You asked: \"remove the old format utility, we use date-fns now\"\n\nThe system will permanently delete src/utils/format.ts.",
    status: "pending",
  },
  {
    id: "m16", file_path: "src/components/Badge.tsx", action_type: "create",
    system_will: {
      summary: "Create new file: src/components/Badge.tsx",
      changes: [{ file: "src/components/Badge.tsx", details: "Write Badge UI component" }],
      impact: ["New component — no existing behaviour changed."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add a Badge component for status labels\"\n\nThe system will create src/components/Badge.tsx.",
    status: "pending",
  },
  {
    id: "m17", file_path: "src/routes/index.tsx", action_type: "update",
    system_will: {
      summary: "Update route config — add /settings route",
      changes: [{ file: "src/routes/index.tsx", details: "Add SettingsPage route entry" }],
      impact: ["New route registered — navigation menu may need a corresponding link."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add the settings page to the router\"\n\nThe system will add a /settings route entry to src/routes/index.tsx.",
    status: "pending",
  },
  {
    id: "m18", file_path: "vite.config.ts", action_type: "update",
    system_will: {
      summary: "Modify vite.config.ts — add path alias",
      changes: [{ file: "vite.config.ts", details: "Add @/ alias pointing to src/" }],
      impact: ["All subsequent import paths may use @/ shorthand.", "Existing absolute imports remain unaffected."],
      risk_notes: ["Build config changes — run npm run build to verify before merging."],
    },
    risk_level: "medium",
    why_explanation: "You asked: \"add the @/ path alias to Vite config\"\n\nThe system will update vite.config.ts with the alias configuration.",
    status: "pending",
  },
  {
    id: "m19", file_path: "src/components/Spinner.tsx", action_type: "create",
    system_will: {
      summary: "Create new file: src/components/Spinner.tsx",
      changes: [{ file: "src/components/Spinner.tsx", details: "Write loading spinner component" }],
      impact: ["New component — no existing behaviour changed."],
      risk_notes: [],
    },
    risk_level: "low",
    why_explanation: "You asked: \"add a loading spinner component\"\n\nThe system will create src/components/Spinner.tsx.",
    status: "pending",
  },
  {
    id: "m20", file_path: "package-lock.json", action_type: "update",
    system_will: {
      summary: "Modify package-lock.json — regenerate lock file",
      changes: [{ file: "package-lock.json", details: "Full lockfile regeneration after dependency changes" }],
      impact: ["Lock file regenerated — all dependency versions resolved.", "Large diff expected — this is normal after adding packages."],
      risk_notes: ["Lock file changes affect reproducible installs across all environments — verify npm ci still works."],
    },
    risk_level: "high",
    why_explanation: "You asked: \"regenerate the lock file after adding lodash\"\n\nThe system will update package-lock.json. Verify npm ci succeeds after this step.",
    status: "pending",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type LoadState = "loading" | "ready" | "error";
type Tab = "review" | "timeline";
type Props = { sessionId?: string };

// ─── Component ────────────────────────────────────────────────────────────────

export function ExecutionPanel({ sessionId }: Props) {
  const [steps,            setSteps]            = useState<ExecutionStep[]>([]);
  const [loadState,        setLoadState]        = useState<LoadState>(sessionId ? "loading" : "ready");
  const [errorMsg,         setErrorMsg]         = useState("");
  const [focused,          setFocused]          = useState(0);
  const [externalDrift,    setExternalDrift]    = useState(false);
  const [activeTab,        setActiveTab]        = useState<Tab>("review");
  const [timelineKey,      setTimelineKey]      = useState(0); // bump to re-fetch timeline
  const [undoing,          setUndoing]          = useState(false);
  const [undoNotice,       setUndoNotice]       = useState<string | null>(null);
  const [batching,         setBatching]         = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // ── Initial data fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) { setSteps(MOCK_STEPS); setLoadState("ready"); return; }
    let cancelled = false;
    setLoadState("loading");
    getSessionSteps(sessionId)
      .then(({ steps: fetched }) => {
        if (cancelled) return;
        setSteps(fetched);
        setLoadState("ready");
        setFocused(fetched.findIndex(s => s.status === "pending"));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load steps.");
        setLoadState("error");
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  // ── Concurrency safety: refetch on tab regain ───────────────────────────────
  // If another tab made decisions, reconcile to server state (last-write-wins)
  // and surface a dismissible notice so the user knows their view was refreshed.
  useEffect(() => {
    if (!sessionId) return;

    function refetchOnFocus() {
      getSessionSteps(sessionId!)
        .then(({ steps: fetched }) => {
          setSteps(prev => {
            const drifted = fetched.some(f => {
              const local = prev.find(p => p.id === f.id);
              return local !== undefined && local.status !== f.status;
            });
            if (drifted) setExternalDrift(true);
            return fetched;
          });
        })
        .catch(() => { /* silent — network may be down */ });
    }

    function onVisibility() {
      if (document.visibilityState === "visible") refetchOnFocus();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refetchOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refetchOnFocus);
    };
  }, [sessionId]);

  // ── Undo handler — revert last approved step back to pending ───────────────
  const handleUndo = useCallback(async () => {
    if (!sessionId || undoing) return;
    setUndoing(true);
    setUndoNotice(null);
    try {
      const result = await undoLastApproval(sessionId);
      if (result.success) {
        setSteps(prev =>
          prev.map(s => s.id === result.stepId ? { ...s, status: "pending" } : s)
        );
        setFocused(prev => {
          const idx = steps.findIndex(s => s.id === result.stepId);
          return idx !== -1 ? idx : prev;
        });
        setUndoNotice(`Approval reverted — ${result.file_path} is pending review again.`);
        setTimelineKey(k => k + 1);
      } else {
        setUndoNotice("No approved steps to revert.");
      }
    } catch {
      setUndoNotice("Revert failed — try again.");
    } finally {
      setUndoing(false);
    }
  }, [sessionId, undoing, steps]);

  // ── Batch approve handler ───────────────────────────────────────────────────
  // Approves contiguous LOW-risk pending steps starting from the current focused
  // position. Stops immediately before any non-LOW or non-pending step.
  // Never touches HIGH risk steps — they require individual review.
  const handleBatchApprove = useCallback(async (stepsToApprove: typeof steps) => {
    if (batching || stepsToApprove.length === 0) return;
    setBatching(true);
    try {
      for (const step of stepsToApprove) {
        await recordStepDecision(step.id, "approved");
        setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "approved" } : s));
        setTimelineKey(k => k + 1);
      }
      // Advance focus to next pending step after the batch.
      setSteps(prev => {
        const nextPending = prev.findIndex(s => s.status === "pending");
        if (nextPending !== -1) setFocused(nextPending);
        return prev;
      });
    } finally {
      setBatching(false);
    }
  }, [batching]);

  // ── Decision handler — auto-advance focus, bump timeline key ───────────────
  const handleDecision = useCallback((stepId: string, decision: "approved" | "rejected") => {
    setSteps(prev => {
      const next = prev.map(s => s.id === stepId ? { ...s, status: decision } : s);
      const currentIdx  = next.findIndex(s => s.id === stepId);
      const nextPending = next.findIndex((s, i) => i > currentIdx && s.status === "pending");
      const anyPending  = next.findIndex(s => s.status === "pending");
      const nextFocus   = nextPending !== -1 ? nextPending : anyPending;
      if (nextFocus !== -1) setFocused(nextFocus);
      return next;
    });
    setTimelineKey(k => k + 1);
  }, []);

  // ── Panel-level keyboard navigation ────────────────────────────────────────
  useEffect(() => {
    if (loadState !== "ready") return;
    const el = panelRef.current;
    if (!el) return;

    function onKey(e: KeyboardEvent) {
      // Only fire if focus is within the panel or on the panel itself.
      if (!panelRef.current?.contains(document.activeElement) &&
          document.activeElement !== panelRef.current) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocused(i => Math.min(i + 1, steps.length - 1));
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocused(i => Math.max(i - 1, 0));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadState, steps.length]);

  // ── Derived counts ─────────────────────────────────────────────────────────
  const total    = steps.length;
  const pending  = steps.filter(s => s.status === "pending").length;
  const approved = steps.filter(s => s.status === "approved").length;
  const rejected = steps.filter(s => s.status === "rejected").length;
  const decided  = approved + rejected;
  const progress = total > 0 ? Math.round((decided / total) * 100) : 0;
  const allDone  = pending === 0 && total > 0;

  // Contiguous LOW-risk pending steps starting from current focused position.
  // Stops before the first non-LOW or non-pending step.
  // Empty when focused step is not LOW pending, or when batch would be trivial (1 step).
  const batchCandidates = (() => {
    const focusedStep = steps[focused];
    if (!focusedStep || focusedStep.status !== "pending" || focusedStep.risk_level !== "low") {
      return [];
    }
    const candidates: typeof steps = [];
    for (let i = focused; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.status !== "pending" || s.risk_level !== "low") break;
      candidates.push(s);
    }
    return candidates.length > 1 ? candidates : [];
  })();

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="min-h-full bg-gray-950 text-gray-100 p-6 outline-none"
    >
      <div className="max-w-2xl mx-auto">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Execution Review
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Review what will run before anything touches your workspace.
          </p>
          {sessionId && (
            <p className="mt-1 text-[10px] font-mono text-gray-700">
              session {sessionId}
            </p>
          )}
        </div>

        {/* ── Tab bar (only when we have a real session) ───────────────── */}
        {sessionId && (
          <div className="flex gap-1 mb-5 border-b border-gray-800 pb-0">
            {(["review", "timeline"] as Tab[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`
                  px-4 py-2 text-xs font-semibold uppercase tracking-wider
                  border-b-2 -mb-px transition-colors
                  ${activeTab === tab
                    ? "border-[#00D4FF] text-[#00D4FF]"
                    : "border-transparent text-gray-600 hover:text-gray-400"}
                `}
              >
                {tab === "review" ? "Review" : "Timeline"}
              </button>
            ))}
          </div>
        )}

        {/* ── Timeline tab ─────────────────────────────────────────────── */}
        {activeTab === "timeline" && sessionId && (
          <SessionTimeline key={timelineKey} sessionId={sessionId} />
        )}

        {/* ── Review tab content ───────────────────────────────────────── */}
        {activeTab === "review" && (
          <>
            {/* Concurrency drift notice */}
            {externalDrift && (
              <div className="mb-4 flex items-center justify-between gap-3
                              rounded-lg border border-amber-700/40 bg-amber-950/30
                              px-4 py-2.5 text-xs text-amber-400">
                <span>
                  <span className="font-semibold">Plan updated in another tab.</span>
                  {" "}This view has been refreshed to match the latest state.
                </span>
                <button
                  type="button"
                  onClick={() => setExternalDrift(false)}
                  className="shrink-0 text-amber-600 hover:text-amber-400 transition-colors"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Loading */}
            {loadState === "loading" && (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-10 text-center">
                <p className="text-sm text-gray-500">Loading execution plan…</p>
              </div>
            )}

            {/* Error */}
            {loadState === "error" && (
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 text-center">
                <p className="text-sm text-red-400">{errorMsg}</p>
              </div>
            )}

            {/* Ready — steps */}
            {loadState === "ready" && total > 0 && (
              <>
                {/* Progress bar + stats + undo */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-1.5 text-xs text-gray-500">
                    <span>
                      {decided} of {total} reviewed
                      {pending > 0 && <span className="ml-2 text-gray-400">{pending} pending</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      {approved > 0 && <span className="text-emerald-500">{approved} approved</span>}
                      {rejected > 0 && <span className="text-red-500">{rejected} rejected</span>}
                      {/* Revert last approval — only when session is real and there are approved steps */}
                      {sessionId && approved > 0 && (
                        <button
                          type="button"
                          disabled={undoing}
                          onClick={() => void handleUndo()}
                          className="flex items-center gap-1 text-gray-600 hover:text-gray-400
                                     transition-colors disabled:opacity-40"
                          title="Move the most recently approved step back to pending"
                        >
                          <span className="text-[11px]">↩</span>
                          <span className="text-[10px]">
                            {undoing ? "Reverting…" : "Revert last approval"}
                          </span>
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#00D4FF] transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {/* Undo confirmation notice */}
                  {undoNotice && (
                    <div className="mt-2 flex items-center justify-between text-[10px]
                                    text-gray-500 font-mono">
                      <span>{undoNotice}</span>
                      <button
                        type="button"
                        onClick={() => setUndoNotice(null)}
                        className="text-gray-700 hover:text-gray-500 ml-3"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Keyboard hint + batch approve */}
                {!allDone && (
                  <div className="mb-4 flex flex-wrap items-center gap-3 text-[10px] text-gray-600 font-mono">
                    <span>
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">j</kbd>
                      {" / "}
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">k</kbd>
                      {" navigate"}
                    </span>
                    <span>
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">a</kbd>
                      {" approve"}
                    </span>
                    <span>
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">r</kbd>
                      {" reject"}
                    </span>
                    {/* Batch approve — only for contiguous LOW risk pending steps.
                        Framed as bounded and exceptional, not as a speed shortcut. */}
                    {batchCandidates.length > 1 && (
                      <button
                        type="button"
                        disabled={batching}
                        onClick={() => void handleBatchApprove(batchCandidates)}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1
                                   rounded border border-emerald-800/50 bg-emerald-950/30
                                   text-emerald-500 hover:bg-emerald-950/60
                                   transition-colors disabled:opacity-40 normal-case font-sans"
                        title={`Approve this group of ${batchCandidates.length} contiguous low-risk steps. Stops before any medium or high-risk step.`}
                      >
                        {batching ? (
                          <span className="text-[10px]">Approving group…</span>
                        ) : (
                          <>
                            <span className="text-[11px]">✓✓</span>
                            <span className="text-[10px]">
                              Approve this low-risk group ({batchCandidates.length} steps)
                            </span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Step list */}
                <div className="space-y-3">
                  {steps.map((step, idx) => (
                    <ExecutionStepCard
                      key={step.id}
                      step={step}
                      index={idx}
                      focused={focused === idx}
                      onDecision={handleDecision}
                      onFocus={() => setFocused(idx)}
                    />
                  ))}
                </div>

                {/* All decided — closure message + timeline nudge */}
                {allDone && (
                  <div className="mt-6 rounded-xl border border-gray-700 bg-gray-900 p-5 text-center">
                    <p className="text-sm font-semibold text-gray-300">
                      All {total} steps reviewed.
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {approved > 0 && `${approved} approved`}
                      {approved > 0 && rejected > 0 && " · "}
                      {rejected > 0 && `${rejected} rejected`}
                    </p>
                    <p className="text-xs text-gray-600 mt-3">
                      Return to your workflow tab to continue.
                      {sessionId && (
                        <span>
                          {" "}
                          <button
                            type="button"
                            onClick={() => setActiveTab("timeline")}
                            className="text-[#00D4FF]/60 hover:text-[#00D4FF] transition-colors underline underline-offset-2"
                          >
                            View decision timeline ↗
                          </button>
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </>
            )}

            {loadState === "ready" && total === 0 && (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-10 text-center">
                <p className="text-sm text-gray-500">No steps in this session.</p>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
