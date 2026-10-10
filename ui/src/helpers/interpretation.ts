/**
 * Phase 11A-Web: Interpretation display helper.
 *
 * UI-W6: If interpretation adds no value, it must be hidden.
 * UI-W5: Approval views must show raw input before interpreted summary.
 *
 * Pure helper — no React, no DOM, no network. Shared by any presenter.
 */

/**
 * Known vague placeholder phrases emitted by the interpreter when it cannot
 * classify the change type. These add zero meaning beyond the raw input and
 * must be suppressed (UI-W6).
 *
 * Matched case-insensitively against the trimmed summary.
 * Add new entries here — never remove existing ones.
 */
const VAGUE_SUMMARIES = new Set([
  "input is a deterministic, self-contained request.",
  "input appears to be a self-contained change.",
  "the input is self-contained.",
  "this is a self-contained change.",
  "input is self-contained.",
  // Legacy fallback phrase — adds no information beyond the raw input.
  "this step will run exactly as written.",
]);

/**
 * Returns true if the interpreted summary adds meaning beyond the raw input.
 *
 * Hides the "System understood:" section when:
 *   - summary is absent or empty
 *   - summary is a trivially short placeholder (< 8 chars)
 *   - summary is identical to input (case-insensitive, trimmed)
 *   - summary is a known vague placeholder phrase (VAGUE_SUMMARIES)
 */
export function shouldShowInterpretation(
  input:    string,
  summary?: string | null,
): boolean {
  if (!summary || summary.trim().length < 8) return false;
  const trimmed = summary.trim().toLowerCase();
  if (VAGUE_SUMMARIES.has(trimmed)) return false;
  return input.trim().toLowerCase() !== trimmed;
}

/**
 * Extracts "You asked:" and "System understood:" from a ShellFrame's rendered
 * lines when those labels appear (injected by renderWorkflowFrame in Phase 11D).
 *
 * Returns null if the frame doesn't contain these labels.
 */
export function extractDualDisplay(lines: readonly string[]): {
  rawInput:   string;
  understood: string | null;
} | null {
  const askedIdx = lines.findIndex(l => l.startsWith("  You asked:"));
  if (askedIdx === -1) return null;

  const rawInput = lines[askedIdx]!.replace(/^\s*You asked:\s*/, "").trim();

  const understoodIdx = lines.findIndex(l => l.startsWith("  System understood:"));
  const understood = understoodIdx !== -1
    ? lines[understoodIdx]!.replace(/^\s*System understood:\s*/, "").trim()
    : null;

  return { rawInput, understood };
}
