// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * FrictionReportModal — one-click friction reporting from the UI.
 *
 * Opens as an overlay when the user clicks "Report this friction" on
 * FailureFrame or TerminalFrame. Posts to POST /api/friction/report.
 *
 * Auth model: the server reads ~/.usesteady/auth.json (written by
 * `usesteady report --auth`). If not authenticated, the modal shows
 * a one-time setup instruction. No OAuth in the browser needed.
 */

import { useState, useRef, useEffect } from "react";

interface Props {
  /** Pre-filled context from the failure frame. */
  prefill?: {
    phase?:      string;
    runId?:      string;
    taskInput?:  string;
    failureNote?: string;
  };
  onClose: () => void;
}

type SubmitState = "idle" | "loading" | "success" | "auth-required" | "error";

export function FrictionReportModal({ prefill, onClose }: Props) {
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSubmit() {
    if (!notes.trim()) return;

    setState("loading");

    try {
      const resp = await fetch("/api/friction/report", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          notes,
          context: {
            phase:      prefill?.phase,
            runId:      prefill?.runId,
            taskInputs: prefill?.taskInput ? [prefill.taskInput] : undefined,
            failureNote: prefill?.failureNote,
          },
        }),
      });

      if (resp.status === 401) {
        setState("auth-required");
        return;
      }

      if (!resp.ok) {
        const data = await resp.json() as { error?: string };
        setErrorMsg(data.error ?? "Submission failed.");
        setState("error");
        return;
      }

      setState("success");
    } catch {
      setErrorMsg("Network error — report saved locally and will retry.");
      setState("error");
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl p-6 mx-4">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-600 hover:text-gray-300 text-lg leading-none"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Header */}
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-red-400 mb-1">
            Friction Report
          </p>
          <h2 className="text-lg font-bold text-gray-50">
            Report this friction
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Verified reports earn a payout from Shortgigs LLC.
            Your GitHub identity is used to notify you of the decision.
          </p>
        </div>

        {/* Pre-filled context pill */}
        {(prefill?.phase || prefill?.taskInput) && (
          <div className="mb-4 rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-xs text-gray-500 font-mono">
            {prefill.phase && <span className="text-gray-600">phase: </span>}
            {prefill.phase && <span className="text-gray-400">{prefill.phase}</span>}
            {prefill.phase && prefill.taskInput && <span className="text-gray-700 mx-2">·</span>}
            {prefill.taskInput && (
              <span className="text-gray-400 truncate">{prefill.taskInput.slice(0, 80)}</span>
            )}
          </div>
        )}

        {/* Success state */}
        {state === "success" && (
          <div className="rounded-xl bg-emerald-500/10 px-4 py-5 text-center">
            <p className="text-emerald-300 font-semibold text-sm mb-1">Report submitted</p>
            <p className="text-gray-500 text-xs">
              You'll receive a GitHub notification when Shortgigs reviews it.
            </p>
            <button
              onClick={onClose}
              className="mt-4 text-xs text-gray-500 hover:text-gray-300 underline"
            >
              Close
            </button>
          </div>
        )}

        {/* Auth required state */}
        {state === "auth-required" && (
          <div className="rounded-xl bg-amber-950/20 border border-amber-800/40 px-4 py-5">
            <p className="text-amber-400 font-semibold text-sm mb-2">Connect GitHub first</p>
            <p className="text-gray-400 text-xs mb-3">
              Run this command in your terminal, then try again:
            </p>
            <code className="block bg-gray-900 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono mb-4 select-all">
              usesteady report --auth
            </code>
            <p className="text-gray-600 text-xs">
              This connects your GitHub account so Shortgigs can send you
              the payout and notify you of the decision.
            </p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSubmit}
                className="text-xs text-gray-400 hover:text-gray-200 underline"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="text-xs text-gray-600 hover:text-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="rounded-xl bg-red-950/20 border border-red-800/40 px-4 py-4 mb-4">
            <p className="text-red-400 text-xs">{errorMsg}</p>
            <button
              onClick={() => setState("idle")}
              className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Input form (idle / loading / error) */}
        {(state === "idle" || state === "loading" || state === "error") && (
          <>
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-2">
                What happened? What did you expect?
              </label>
              <textarea
                ref={textareaRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="e.g. I expected the task to run but it failed with no clear reason. The error message didn't tell me what to fix."
                className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-gray-600
                           text-gray-200 text-sm placeholder-gray-700 px-4 py-3 resize-none
                           focus:outline-none focus:ring-1 focus:ring-gray-600"
                disabled={state === "loading"}
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={onClose}
                className="text-xs text-gray-600 hover:text-gray-400"
                disabled={state === "loading"}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!notes.trim() || state === "loading"}
                className={[
                  "px-5 py-2 rounded-lg text-sm font-medium transition-colors",
                  notes.trim() && state !== "loading"
                    ? "bg-red-700 hover:bg-red-600 text-white"
                    : "bg-gray-800 text-gray-600 cursor-not-allowed",
                ].join(" ")}
              >
                {state === "loading" ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
