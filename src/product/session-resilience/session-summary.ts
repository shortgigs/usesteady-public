/**
 * Session Summary — Phase 6C.
 *
 * Produces a deterministic, human-readable summary of a terminal session.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────
 *
 *   summarizeSession(state) → SessionSummary | null
 *
 *   Returns null for non-terminal sessions.
 *   For terminal sessions, returns a summary derived only from actual state facts.
 *   No narrative invention. No references to unexecuted actions.
 *   Deterministic: same state → same summary.
 *
 * ── Authority constraint ──────────────────────────────────────────────────────
 *
 *   This function reads state facts and describes them.
 *   It does not evaluate, route, or re-run any upstream logic.
 */

import type { CursorSessionState } from "../cursor-product-session.js";
import { isTerminal } from "../cursor-product-session.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * SessionSummary — a terminal session audit record.
 *
 *   finalPhase  — the exact phase the session terminated in.
 *   headline    — one-sentence summary of the outcome.
 *   notes       — zero or more supporting detail items derived from state.
 */
export type SessionSummary = {
  readonly finalPhase: string;
  readonly headline:   string;
  readonly notes:      readonly string[];
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Summarize a terminal session into a structured audit record.
 *
 * Returns null for non-terminal sessions.
 * Returns a SessionSummary for all terminal phases.
 */
export function summarizeSession(state: CursorSessionState): SessionSummary | null {
  if (!isTerminal(state)) return null;

  const notes: string[] = [];

  if (state.input) {
    notes.push(`Input: "${state.input}"`);
  }

  if (state.display.changeSummary) {
    notes.push(`Change: ${state.display.changeSummary}`);
  }

  if (state.display.targetFiles && state.display.targetFiles.length > 0) {
    notes.push(`Target: ${state.display.targetFiles.join(", ")}`);
  }

  if (state.display.resultNote) {
    notes.push(`Note: ${state.display.resultNote}`);
  }

  if (state.intentId) {
    notes.push(`Intent ID: ${state.intentId}`);
  }

  return {
    finalPhase: state.phase,
    headline:   headlineFor(state),
    notes,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function headlineFor(state: CursorSessionState): string {
  switch (state.phase) {
    case "accepted":
      return "Edit was applied successfully.";
    case "rejected":
      return "Edit was rejected by the user.";
    case "exec_error":
      return "Execution failed with an error.";
    case "blocked":
      return "Session was blocked and could not complete.";
    case "not_execute":
      return "Input was not an executable edit command.";
    case "intake_failed":
      return "Intake pipeline encountered an unexpected error.";
    default:
      return `Session ended in phase: ${state.phase}.`;
  }
}
