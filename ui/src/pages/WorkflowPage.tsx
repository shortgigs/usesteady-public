/**
 * Phase 11A-Web / Phase 11E: WorkflowPage — application container.
 * UI Redesign: polished idle screen with container card, refined tab control.
 */

import { useState, useRef, useEffect }  from "react";
import posthog                          from "posthog-js";
import { saveRecentPath, getRecentPaths, WorkspacePicker } from "../components/workflow/WorkflowBuilder.js";
import { WorkflowHeader }               from "../components/workflow/WorkflowHeader.js";
import { WorkflowTaskSidebar }          from "../components/workflow/WorkflowTaskSidebar.js";
import { WorkflowFramePanel }           from "../components/workflow/WorkflowFramePanel.js";
import { WorkflowBuilder }              from "../components/workflow/WorkflowBuilder.js";
import { renderSurfaceWeb }             from "../components/workflow/renderSurfaceWeb.js";
import { LoadingState }                 from "../components/ui/LoadingState.js";
import { ErrorState }                   from "../components/ui/ErrorState.js";
import { Button }                       from "../components/ui/Button.js";
import { useWorkflowRun }               from "../hooks/useWorkflowRun.js";
import { buildQuickStartSpec }          from "../helpers/quickStart.js";
import type { WorkflowSpec, IntentReflectionArtifact, ConfirmedUnderstandingV1 } from "../api/types.js";
import type { StartOpts }               from "../hooks/useWorkflowRun.js";

const CONFIRMATION_PROMPT = "Is this correct?";

function hasReflectionArtifact(
  artifact: IntentReflectionArtifact | undefined,
): artifact is IntentReflectionArtifact {
  return !!artifact && Array.isArray(artifact.key_points) && artifact.key_points.length > 0;
}

// ─── Tab switcher — segmented control ────────────────────────────────────────

type Tab = "quick" | "build" | "load";

const TAB_LABEL: Record<Tab, string> = {
  quick: "Quick start",
  build: "Build",
  load:  "Load spec",
};

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-0.5 p-1 bg-gray-900/80 rounded-lg border border-gray-800 self-start">
      {(["quick", "build", "load"] as Tab[]).map(t => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-100
            ${active === t
              ? "bg-gray-800 text-gray-100 shadow-sm"
              : "text-gray-500 hover:text-gray-300"
            }`}
        >
          {TAB_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

// ─── Quick start (inverted entry — text-to-spec, no hand-authoring) ───────────

function QuickStart({
  onStart,
  loading,
  initialText,
}: {
  onStart:      (spec: WorkflowSpec, opts?: StartOpts) => Promise<void>;
  loading:      boolean;
  initialText?: string;
}) {
  const [text,      setText]      = useState(() => initialText ?? "");
  const [workspace, setWorkspace] = useState(() => getRecentPaths()[0] ?? "");

  const spec      = buildQuickStartSpec(text);
  const taskCount = spec?.tasks.length ?? 0;
  const canStart  = spec !== null && workspace.trim().length > 0;

  async function handleContinue() {
    if (!spec || !workspace.trim()) return;
    saveRecentPath(workspace.trim());
    await onStart(spec, { workspaceRoot: workspace.trim() });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleContinue();
    }
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-col gap-1.5">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          autoFocus
          placeholder={
            "Describe the change you want — or paste a plan from Claude, Cursor, or Copilot.\n\n" +
            "e.g. rename getCwd to getCurrentWorkingDirectory in src/utils.ts"
          }
          className="w-full bg-gray-800/60 border border-gray-700/50 rounded-xl
                     px-4 py-3 text-base text-gray-100 resize-none
                     placeholder:text-gray-600 placeholder:text-sm
                     focus:outline-none focus:border-[#00D4FF]/60
                     focus:ring-1 focus:ring-[#00D4FF]/20 transition-colors"
        />
        <p className="text-[11px] text-gray-600 leading-snug">
          One change per line. You'll confirm understanding and approve every step
          before anything runs — nothing executes yet.
        </p>
      </div>

      <WorkspacePicker value={workspace} onChange={setWorkspace} />

      <div className="flex flex-col gap-2">
        <Button
          label={taskCount > 1 ? `Continue with ${taskCount} steps →` : "Continue →"}
          variant="primary"
          size="lg"
          onClick={() => void handleContinue()}
          disabled={!canStart}
          loading={loading}
        />
        {!canStart && (
          <p className="text-xs text-gray-600">
            {text.trim().length === 0
              ? "Describe a change or paste a plan to continue"
              : "Select an execution location to continue"}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── SpecDropZone (Load tab) ──────────────────────────────────────────────────

function SpecDropZone({
  onLoad,
  onSwitchToBuild,
}: {
  onLoad:           (spec: WorkflowSpec) => void;
  onSwitchToBuild:  () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const spec = JSON.parse(text) as WorkflowSpec;
      if (!spec.name || !Array.isArray(spec.tasks) || spec.tasks.length === 0) {
        setError("Invalid spec: must have a name and at least one task.");
        return;
      }
      onLoad(spec);
    } catch {
      setError("Could not parse JSON. Check the file format.");
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      {error && <ErrorState message={error} />}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-800 rounded-xl p-12
                   flex flex-col items-center gap-4 text-center
                   hover:border-[#00D4FF]/30 hover:bg-[#00D4FF]/2
                   transition-all duration-150 cursor-pointer group"
      >
        <div className="w-12 h-12 rounded-xl bg-gray-800 border border-gray-700
                        flex items-center justify-center text-xl
                        group-hover:border-[#00D4FF]/30 transition-colors">
          📋
        </div>
        <div>
          <p className="text-gray-300 font-medium">Drop a workflow spec</p>
          <p className="text-gray-600 text-sm mt-1">
            or click to browse · accepts <span className="font-mono">.json</span> files
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleChange}
        />
      </div>

      <p className="text-xs text-gray-600 text-center">
        Don't have a spec file?{" "}
        <button
          type="button"
          className="text-[#00D4FF]/70 hover:text-[#00D4FF] underline underline-offset-2 transition-colors"
          onClick={onSwitchToBuild}
        >
          Build tab
        </button>{" "}
        lets you create one, then save it for reuse.
      </p>
    </div>
  );
}

// ─── Idle entry screen ────────────────────────────────────────────────────────

type IdleProps = {
  onStart:        (spec: WorkflowSpec, opts?: StartOpts) => Promise<void>;
  loading:        boolean;
  error?:         string | null;
  prefillInput?:  string | null;
};

function IdleScreen({ onStart, loading, error, prefillInput }: IdleProps) {
  // A "Try this" suggestion pre-fills a single structured task → land on Build.
  // Otherwise Quick start is the default door (shortest path to ApprovalFrame).
  const [tab,            setTab]            = useState<Tab>(prefillInput ? "build" : "quick");
  const [pendingSpec,    setPendingSpec]    = useState<WorkflowSpec | null>(null);
  const [loadWorkspace,  setLoadWorkspace]  = useState(() => getRecentPaths()[0] ?? "");

  function handleSpecLoaded(spec: WorkflowSpec) {
    setPendingSpec(spec);
    setLoadWorkspace(prev => prev || (getRecentPaths()[0] ?? ""));
  }

  async function handleConfirmLoad() {
    if (!pendingSpec) return;
    if (loadWorkspace.trim()) saveRecentPath(loadWorkspace.trim());
    await onStart(pendingSpec, { workspaceRoot: loadWorkspace.trim() || undefined });
  }

  const loadCanStart = !!pendingSpec && loadWorkspace.trim().length > 0;


  return (
    <div className="flex flex-col min-h-full bg-gray-950">
      <main className="flex-1 flex justify-center px-6 py-10">
        <div className="w-full max-w-2xl flex flex-col gap-6">

          {/* Hero heading */}
          <div className="mb-2">
            <h1 className="text-xl font-semibold text-gray-100 tracking-tight">
              New workflow
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Describe a change or paste an AI plan. Review and approve every step
              before anything runs.
            </p>
          </div>

          {error && <ErrorState message={error} />}

          {/* Container card */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">

            {/* Tab bar inside container */}
            <div className="flex items-center gap-0.5 px-4 pt-4 pb-0">
              <TabBar
                active={tab}
                onChange={t => { setTab(t); setPendingSpec(null); setLoadWorkspace(""); }}
              />
            </div>

            <div className="p-5 pt-4">
              {tab === "quick" && (
                <QuickStart onStart={onStart} loading={loading} />
              )}

              {tab === "build" && (
                <WorkflowBuilder
                  onBuild={(spec, opts) => void onStart(spec, opts)}
                  loading={loading}
                  initialTaskInput={prefillInput ?? undefined}
                />
              )}

              {tab === "load" && !pendingSpec && (
                <SpecDropZone
                  onLoad={handleSpecLoaded}
                  onSwitchToBuild={() => setTab("build")}
                />
              )}

              {tab === "load" && pendingSpec && (
                <div className="flex flex-col gap-4">

                  {/* Spec preview */}
                  <div className="rounded-xl bg-gray-950 border border-gray-800 p-4">
                    <p className="text-sm font-semibold text-gray-100">{pendingSpec.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {pendingSpec.tasks.length} task{pendingSpec.tasks.length !== 1 ? "s" : ""}
                    </p>
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {pendingSpec.tasks.map((t, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-500">
                          <span className="flex-none w-4 h-4 rounded-full bg-gray-800
                                           text-gray-600 flex items-center justify-center
                                           font-mono text-[9px] mt-0.5">
                            {i + 1}
                          </span>
                          <span className="font-mono text-gray-400 truncate">{t.input}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Execution location — same WorkspacePicker used in Build tab */}
                  <WorkspacePicker value={loadWorkspace} onChange={setLoadWorkspace} />

                  <div className="flex flex-col gap-2">
                    <div className="flex gap-3">
                      <Button
                        label="Start workflow"
                        variant="primary"
                        size="md"
                        onClick={() => void handleConfirmLoad()}
                        disabled={!loadCanStart}
                        loading={loading}
                      />
                      <Button
                        label="Choose different file"
                        variant="ghost"
                        size="md"
                        onClick={() => setPendingSpec(null)}
                      />
                    </div>
                    {!loadCanStart && (
                      <p className="text-xs text-gray-600">
                        Select an execution location to continue
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Confirm Understanding gate (Runtime intent reflection) ─────────────────

type ConfirmGateProps = {
  artifact:   IntentReflectionArtifact;
  onConfirm:  () => void | Promise<void>;
  onRevise:   () => void;
  loading?:   boolean;
};

function ConfirmUnderstandingGate({ artifact, onConfirm, onRevise, loading }: ConfirmGateProps) {
  return (
    <div className="flex flex-col min-h-full bg-gray-950">
      <main className="flex-1 flex justify-center px-6 py-10">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <header className="text-center">
            <span className="inline-flex items-center rounded-full border border-[#00D4FF]/30
                             bg-[#00D4FF]/5 px-3 py-1 text-xs font-medium text-[#00D4FF]/80">
              Understanding only
            </span>
            <h1 className="mt-6 text-2xl font-bold text-gray-50 tracking-tight">
              Confirm your understanding
            </h1>
            <p className="mt-3 text-sm text-gray-500 max-w-md mx-auto">
              Review what we believe you want before any steps or file operations are shown.
            </p>
          </header>

          <section
            className="rounded-2xl border border-[#00D4FF]/25 bg-[#00D4FF]/5 p-6 md:p-8"
            aria-labelledby="runtime-understanding-heading"
          >
            <h2
              id="runtime-understanding-heading"
              className="text-lg font-semibold text-gray-50"
            >
              I believe:
            </h2>
            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-gray-300">
              {artifact.key_points.map((bullet) => (
                <li key={bullet} className="flex gap-2">
                  <span aria-hidden className="text-[#00D4FF] flex-none">-</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-base font-semibold text-gray-100">
              {CONFIRMATION_PROMPT}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Understanding only — no file paths or SYSTEM WILL until you confirm.
            </p>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Button
              label="Revise intent"
              variant="ghost"
              size="md"
              onClick={onRevise}
            />
            <Button
              label="Confirm understanding"
              variant="primary"
              size="md"
              onClick={onConfirm}
              loading={loading}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function WorkflowPage() {
  const handle = useWorkflowRun();

  // prefillInput: set when user clicks "Try this" on a SYSTEM SUGGESTS item.
  // Cleared on workflow start so subsequent resets don't carry stale text.
  const [prefillInput, setPrefillInput] = useState<string | null>(null);

  // Client-side gate: intentReflection on RunResponse requires confirm before ReviewingFrame.
  // SSE initial event strips intentReflection from response — capture in ref on first sight.
  const [understandingConfirmed, setUnderstandingConfirmed] = useState(false);
  const [confirmingUnderstanding, setConfirmingUnderstanding] = useState(false);
  const capturedReflectionRef = useRef<IntentReflectionArtifact | null>(null);

  // Hooks must be unconditional — hoisted above all early returns.
  const trackedPhase = useRef<string | null>(null);
  const response = handle.state.status === "ready" ? handle.state.response : null;
  const run = response?.run ?? null;

  useEffect(() => {
    if (!run) return;
    const TERMINAL = ["completed", "stopped", "task_failed", "cancelled"];
    if (TERMINAL.includes(run.phase) && trackedPhase.current !== run.phase) {
      trackedPhase.current = run.phase;
      posthog.capture(`workflow_${run.phase}_ui`, {
        task_count: run.tasks?.length ?? 0,
      });
    }
  }, [run?.phase, run?.tasks?.length]);

  // capability_split_shown + capability_split_action events are captured
  // inside FailureFrame where the failure message text is directly available.

  async function handleStart(spec: WorkflowSpec, opts?: StartOpts) {
    setPrefillInput(null);
    setUnderstandingConfirmed(false);
    capturedReflectionRef.current = null;
    posthog.capture("workflow_started_ui", {
      task_count: spec.tasks.length,
      name:       spec.name ?? "(unnamed)",
    });
    await handle.start(spec, opts);
  }

  function handleSuggest(input: string) {
    handle.reset();
    setUnderstandingConfirmed(false);
    capturedReflectionRef.current = null;
    setPrefillInput(input);
  }

  function handleReviseUnderstanding() {
    handle.reset();
    setUnderstandingConfirmed(false);
    capturedReflectionRef.current = null;
  }

  async function handleConfirmUnderstanding() {
    const reflection = capturedReflectionRef.current;
    if (!reflection) return;

    const confirmed: ConfirmedUnderstandingV1 = {
      format:       "usesteady.confirmed-understanding.v1",
      bullets:      reflection.key_points,
      rawInput:     reflection.originalRequest,
      confirmedAt:  new Date().toISOString(),
    };

    setConfirmingUnderstanding(true);
    try {
      await handle.confirmUnderstanding(confirmed);
      setUnderstandingConfirmed(true);
      posthog.capture("runtime_understanding_confirmed_ui");
    } finally {
      setConfirmingUnderstanding(false);
    }
  }

  if (handle.state.status === "idle") {
    return <IdleScreen onStart={handleStart} loading={false} prefillInput={prefillInput} />;
  }

  if (handle.state.status === "error") {
    return <IdleScreen onStart={handleStart} loading={false} error={handle.state.error} prefillInput={prefillInput} />;
  }

  // Phase 3B — pre-execution, run-less routing surfaces are dispatched through
  // renderSurfaceWeb (the web renderer is a function of the RoutingSurface engine
  // object). The run flow (system_will / system_suggests via ShellFrame) and the
  // reflection gate remain on their existing, behavior-identical paths below.
  if (handle.state.status === "clarify" || handle.state.status === "safety_block") {
    return renderSurfaceWeb(handle.state.surface, {
      onClarifyAnswer: (answer) => { void handle.clarifyAnswer(answer); },
      onCancel: () => handle.reset(),
    });
  }

  if (handle.state.status === "loading" && !("runId" in handle.state && handle.state.runId)) {
    return (
      <LoadingState
        label="Starting workflow…"
        className="flex items-center justify-center min-h-full bg-gray-950"
      />
    );
  }

  if (!response) {
    return (
      <LoadingState
        label="Processing…"
        className="flex items-center justify-center min-h-full bg-gray-950"
      />
    );
  }

  const { frame, skillSuggestions, executionSessionId, intentReflection } = response;
  const isLoading = handle.state.status === "loading";

  if (hasReflectionArtifact(intentReflection)) {
    capturedReflectionRef.current = intentReflection;
  }

  const pendingReflection = capturedReflectionRef.current;
  const needsUnderstandingConfirm =
    !understandingConfirmed && hasReflectionArtifact(pendingReflection);

  if (needsUnderstandingConfirm) {
    return (
      <ConfirmUnderstandingGate
        artifact={pendingReflection}
        onConfirm={handleConfirmUnderstanding}
        onRevise={handleReviseUnderstanding}
        loading={confirmingUnderstanding || isLoading}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {executionSessionId && (
        <a
          href={`/execution/${executionSessionId}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-4 px-4 py-2.5
                     bg-[#00D4FF]/5 border-b border-[#00D4FF]/20
                     text-sm text-gray-300 hover:bg-[#00D4FF]/10 transition-colors group"
        >
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] animate-pulse" />
            <span className="font-medium text-[#00D4FF]">Execution plan ready</span>
            <span className="text-gray-500">— review what will run before approving each step</span>
          </span>
          <span className="text-[#00D4FF]/60 group-hover:text-[#00D4FF] transition-colors text-xs font-mono">
            Review steps ↗
          </span>
        </a>
      )}
      <WorkflowHeader run={run!} />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <WorkflowTaskSidebar run={run!} />

        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-4 md:p-8">
          <WorkflowFramePanel
            run={run!}
            frame={frame}
            loading={isLoading}
            onConfirm={yes => void handle.confirm(yes)}
            onChoose={idx  => void handle.choose(idx)}
            onReset={handle.reset}
            skillSuggestions={skillSuggestions}
            onSuggest={handleSuggest}
          />
        </main>
      </div>
    </div>
  );
}
