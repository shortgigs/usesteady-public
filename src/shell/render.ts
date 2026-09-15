/**
 * Phase 9A: Shell rendering.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure functions that map session state → ShellFrame.
 *   No I/O. No session transitions. No authority.
 *
 * ── Display contract ──────────────────────────────────────────────────────────
 *
 *   Every frame has:
 *     - A phase header (runtime + phase name)
 *     - One or more content lines (from session.display)
 *     - An optional prompt (matched to the phase's expected next action)
 *
 *   Terminal phases produce no prompt.
 *   "approved" produces no prompt — the CLI advance functions call deliver
 *   immediately after approve, so this phase is not surfaced to the user.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a state machine — it reads phase and display; it does not modify them.
 *   NOT an authority layer — it reflects what the session already decided.
 */

import type { CursorSessionState, SessionPhase } from "../product/cursor-product-session.js";
import type { ClaudeSessionState, ClaudeSessionPhase } from "../product/claude-product-session.js";
import type { ShellFrame, ShellPrompt } from "./types.js";

// ─── Formatting helpers ───────────────────────────────────────────────────────

const DIVIDER = "─".repeat(52);

function header(label: string): string {
  return `${DIVIDER}\n  ${label}\n${DIVIDER}`;
}

function phaseLabel(
  phase:   SessionPhase | ClaudeSessionPhase,
  runtime: "cursor" | "claude",
): string {
  const rt    = runtime === "cursor" ? "Cursor" : "Claude";
  const label = phase.toUpperCase().replace(/_/g, " ");
  return `[${rt}] ${label}`;
}

function buildBodyLines(d: {
  headline:        string;
  changeSummary?:  string | undefined;
  targetFiles?:    readonly string[] | undefined;
  conflicts?:      readonly string[] | undefined;
  scopeCandidates?: readonly string[] | undefined;
  resultNote?:     string | undefined;
}): string[] {
  const lines: string[] = [`  ${d.headline}`];

  if (d.changeSummary) {
    for (const ln of d.changeSummary.split("\n")) {
      lines.push(`  ${ln}`);
    }
  }
  if (d.targetFiles && d.targetFiles.length > 0) {
    lines.push(`  Files:      ${d.targetFiles.join(", ")}`);
  }
  if (d.conflicts && d.conflicts.length > 0) {
    lines.push(`  Conflicts:`);
    for (const c of d.conflicts) {
      lines.push(`    • ${c}`);
    }
  }
  if (d.scopeCandidates && d.scopeCandidates.length > 0) {
    lines.push(`  Candidates:`);
    d.scopeCandidates.forEach((c, i) => {
      lines.push(`    ${i + 1}. ${c}`);
    });
  }
  if (d.resultNote) {
    lines.push(`  Result:     ${d.resultNote}`);
  }

  return lines;
}

function promptForPhase(
  phase:      SessionPhase | ClaudeSessionPhase,
  candidates: readonly string[] | undefined,
): ShellPrompt | undefined {
  switch (phase) {
    case "prepared":
      return { kind: "confirm", question: "Approve this change? (y/n)" };

    case "conflict":
      return { kind: "confirm", question: "Conflicts detected. Accept and proceed anyway? (y/n)" };

    case "scope_question":
      return {
        kind:     "choose",
        question: "Select a file to apply the change (enter number):",
        choices:  candidates ?? [],
      };

    // Terminal phases — no prompt.
    case "accepted":
    case "rejected":
    case "exec_error":
    case "blocked":
    case "not_execute":
    case "intake_failed":
      return undefined;

    // Transient phases not surfaced to user by the CLI advance loop.
    case "idle":
    case "approved":
    default:
      return undefined;
  }
}

// ─── Public rendering functions ───────────────────────────────────────────────

/**
 * Render a Cursor product session state into a ShellFrame.
 *
 * The returned frame is ready to print and optionally prompt.
 * No session state is modified.
 */
export function renderCursorFrame(state: CursorSessionState): ShellFrame {
  const { phase, display } = state;
  const lines: string[] = [
    "",
    header(phaseLabel(phase, "cursor")),
    ...buildBodyLines(display),
    "",
  ];
  const prompt = promptForPhase(phase, display.scopeCandidates);
  return prompt !== undefined ? { lines, prompt } : { lines };
}

/**
 * Render a Claude product session state into a ShellFrame.
 *
 * The returned frame is ready to print and optionally prompt.
 * No session state is modified.
 */
export function renderClaudeFrame(state: ClaudeSessionState): ShellFrame {
  const { phase, display } = state;
  const lines: string[] = [
    "",
    header(phaseLabel(phase, "claude")),
    ...buildBodyLines(display),
    "",
  ];
  const prompt = promptForPhase(phase, display.scopeCandidates);
  return prompt !== undefined ? { lines, prompt } : { lines };
}
