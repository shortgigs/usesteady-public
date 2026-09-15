/**
 * Phase 11A-Web: Failure explanation helper.
 *
 * UI-W7: Failure views must preserve the specific failure cause.
 *
 * Pure helper — no React, no DOM, no network.
 */

export type FailureExplanation = {
  /** The specific failure cause, verbatim. */
  readonly what:   string;
  /** Actionable "what you can do" text. */
  readonly action: string;
};

/**
 * Extracts structured failure explanation from a ShellFrame's rendered lines.
 *
 * Looks for "Failure:" and "What you can do:" sections as rendered by
 * renderWorkflowFrame for the task_failed phase (Phase 9D / 11C).
 */
export function extractFailureExplanation(
  lines: readonly string[],
): FailureExplanation | null {
  const failIdx = lines.findIndex(l =>
    l.includes("Failure:") || l.includes("What went wrong:"),
  );
  if (failIdx === -1) return null;

  const failLine = lines[failIdx]!.replace(/.*Failure:\s*/i, "").trim()
                || lines[failIdx]!.replace(/.*What went wrong:\s*/i, "").trim();

  const actionIdx = lines.findIndex(l => l.includes("What you can do:"));
  const actionLine = actionIdx !== -1
    ? lines[actionIdx]!.replace(/.*What you can do:\s*/i, "").trim()
    : "Retry, skip this task, or stop the workflow.";

  return { what: failLine, action: actionLine };
}

// ─── Failure suggestion (A2) ─────────────────────────────────────────────────

/**
 * Maps a raw error string to a short, actionable next-step hint.
 *
 * Deterministic, static pattern matching only — no model, no dynamic reasoning.
 * Returns null when no known pattern matches; callers must handle null gracefully.
 *
 * Constraint: the raw error must still be displayed verbatim alongside this hint.
 * This is additive only — UI-W7 is never violated.
 */
export function getFailureSuggestion(error: string): string | null {
  const e = error.toLowerCase();

  if (e.includes("file not found") || e.includes("enoent") || e.includes("no such file"))
    return "Check targetFiles or verify the execution location is correct.";

  if (e.includes("not found in file") || e.includes("string not found") || e.includes("pattern not found"))
    return "The expected text was not found. Verify the current file contents before retrying.";

  if (e.includes("permission denied") || e.includes("eacces") || e.includes("access denied"))
    return "The runtime does not have write permission for this path. Check file permissions.";

  if (e.includes("timeout") || e.includes("timed out"))
    return "The step timed out. Try scoping the task to fewer files using targetFiles.";

  if (e.includes("scope contradiction") || e.includes("did not match any"))
    return "The targetFiles list does not match what was found. Verify both the file path and the task input refer to the same file.";

  if (e.includes("no cursor plugin") || e.includes("no claude plugin"))
    return "The runtime plugin is not available. Check the server configuration.";

  if (e.includes("appears more than once") || e.includes("cannot safely apply a targeted replacement") || e.includes("multiple occurrences"))
    return "The target text appears multiple times. Include more surrounding context to make the replacement unique, or narrow scope with targetFiles.";

  return null;
}

/**
 * Returns true when the error is a capability split — the primary model
 * accepted but the secondary model couldn't execute (feasibility issue, not safety).
 * Detected from the "capability_split:" prefix emitted by coordinator.ts.
 */
export function getIsCapabilitySplit(error: string): boolean {
  return error.toLowerCase().startsWith("capability_split:");
}

/**
 * Returns true when the error looks like a governance / policy block rather
 * than a runtime execution error. Excludes capability splits, which have their
 * own layout and different user guidance.
 *
 * Used by FailureFrame to switch to the PolicyBlockFrame layout.
 * Deterministic pattern matching only.
 */
export function getIsPolicyBlock(error: string): boolean {
  if (getIsCapabilitySplit(error)) return false;
  const e = error.toLowerCase();
  return e.includes("blocked") || e.includes("prohibited") ||
         e.includes("not permitted") || e.includes("policy");
}

/**
 * Strips the internal "capability_split:" prefix from a message before display.
 */
export function stripCapabilitySplitPrefix(error: string): string {
  return error.replace(/^capability_split:\s*/i, "");
}

// ─── Failure action buttons ───────────────────────────────────────────────────

/**
 * Maps a ShellFrame "choose" prompt into labelled failure action buttons.
 * Choices are: Retry | Skip | Stop  (positional, as emitted by renderer).
 */
export type FailureAction = {
  readonly label:    string;
  readonly idx:      number;
  readonly variant:  "primary" | "secondary" | "danger";
};

export function failureActions(choices: readonly string[]): FailureAction[] {
  return choices.map((label, idx) => ({
    label,
    idx,
    variant: label.toLowerCase().startsWith("retry") ? "primary"
           : label.toLowerCase().startsWith("stop")  ? "danger"
           : "secondary",
  }));
}
