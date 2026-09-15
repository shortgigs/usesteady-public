/**
 * Reminder Execution Coordinator — Phase 6, integration path.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * A single consumer entry point that bridges the Present Layer (Phase 5) and
 * the Execution Layer (Phase 6). It takes a PresentResult and, if the reminder
 * is ready to confirm, runs the execution pipeline and returns a display-ready
 * outcome.
 *
 * This is the exact equivalent of Phase 5's presentFromInput() for execution:
 *   presentFromInput()   — intake result → display-ready presentation
 *   executeFromPresent() — present result → display-ready execution outcome
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 *
 *   NOT a scheduler       — does not schedule or persist reminders
 *   NOT an OS integration — does not call any calendar/notification APIs
 *   NOT a decision maker  — all decisions flow from intake + execution pipeline
 *   NOT creepy            — does not act without consumer triggering it
 *
 * ── Consumer contract ─────────────────────────────────────────────────────────
 *
 *   Consumer calls executeFromPresent(presentResult) when the user confirms.
 *   Consumer receives ReminderExecuteResult.
 *   Consumer checks result.kind to route:
 *
 *     "accepted"    → show accepted display; ready for downstream scheduling
 *     "rejected"    → show rejection display; prompt user to correct
 *     "not_ready"   → reminder present but incomplete; do not execute
 *     "not_reminder" → was not a reminder at all; ignore or reroute
 *
 * ── "accepted" semantics ──────────────────────────────────────────────────────
 *
 *   "accepted" means: structurally valid for downstream scheduling.
 *   It does NOT mean:  scheduled, delivered, or resolved to a concrete date.
 *   The artifact is the handoff record. A real scheduler would consume it.
 *
 * ── Dependency direction ──────────────────────────────────────────────────────
 *
 *   Coordinator imports Present (PresentResult) and Execution.
 *   Present NEVER imports Execution.
 *   Execution NEVER imports Coordinator.
 *   One-way dependencies only.
 */

import type { PresentResult }               from "../../present/present-coordinator.js";
import type { ReminderPresentationState }   from "../../present/reminders/reminder-types.js";
import type {
  ReminderExecutionArtifact,
  ExecutionRejectionCode,
} from "./reminder-execution-types.js";
import { buildExecutionRequest, executeReminder } from "./reminder-executor.js";

// ─── Display type ─────────────────────────────────────────────────────────────

/**
 * ReminderExecutionDisplay — consumer-ready formatted strings for the result.
 *
 * Keeps the coordinator honest: it formats, it does not execute.
 *
 *   verdict        — "accepted" or "rejected"
 *   headline       — single-line summary ("Reminder accepted" / "Reminder rejected")
 *   subject        — the reminder task, for display
 *   time_text      — the original time phrase, for display (not normalised)
 *   rejection_note — why it was rejected; present only when verdict === "rejected"
 */
export type ReminderExecutionDisplay = {
  readonly verdict:         "accepted" | "rejected";
  readonly headline:        string;
  readonly subject:         string;
  readonly time_text:       string;
  readonly rejection_note?: string;
};

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * ReminderExecuteResult — discriminated union returned by executeFromPresent().
 *
 *   "accepted"     — execution artifact produced with verdict === "accepted"
 *   "rejected"     — execution artifact produced with verdict === "rejected"
 *   "not_ready"    — input was a reminder but not yet complete (missing fields)
 *   "not_reminder" — input was not a reminder at all
 *
 * Both "accepted" and "rejected" arms carry:
 *   - artifact: the full ReminderExecutionArtifact (for UCP mapping, audit)
 *   - display:  formatted strings ready for rendering
 */
export type ReminderExecuteResult =
  | {
      readonly kind:     "accepted";
      readonly artifact: ReminderExecutionArtifact;
      readonly display:  ReminderExecutionDisplay;
    }
  | {
      readonly kind:     "rejected";
      readonly artifact: ReminderExecutionArtifact;
      readonly display:  ReminderExecutionDisplay;
      readonly code:     ExecutionRejectionCode;
    }
  | {
      readonly kind:               "not_ready";
      /** The presentation state explains why it was not ready. */
      readonly presentation_state: ReminderPresentationState;
      /** The fields the user still needs to provide. */
      readonly missing:            readonly string[];
    }
  | {
      readonly kind: "not_reminder";
    };

// ─── executeFromPresent ───────────────────────────────────────────────────────

/**
 * Execute a reminder from an already-produced PresentResult.
 *
 * Call this when the user clicks "Confirm" on a reminder presentation.
 * Returns a ReminderExecuteResult the consumer can render directly.
 *
 * @param presentResult  The output of presentFromInput().
 * @param _now           Epoch ms; defaults to Date.now(). Injectable for tests.
 */
export function executeFromPresent(
  presentResult: PresentResult,
  _now:          number = Date.now(),
): ReminderExecuteResult {
  // ── Not a reminder ────────────────────────────────────────────────────────
  if (presentResult.kind !== "reminder") {
    return { kind: "not_reminder" };
  }

  const presentation = presentResult.presentation;

  // ── Reminder present but not ready ────────────────────────────────────────
  const req = buildExecutionRequest(presentation);
  if (req === null) {
    return {
      kind:               "not_ready",
      presentation_state: presentation.state,
      missing:            presentation.missing_fields,
    };
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  const result = executeReminder(req, _now);
  const display = formatExecutionDisplay(result.artifact);

  if (result.ok) {
    return { kind: "accepted", artifact: result.artifact, display };
  }
  return { kind: "rejected", artifact: result.artifact, display, code: result.code };
}

// ─── Consumer helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the execution result is "accepted".
 *
 * Convenience predicate — consumers use this to enable downstream actions
 * (e.g. passing the artifact to a real scheduler in Phase 7+).
 *
 * Zero authority: this only reads the result, never changes it.
 */
export function isExecutionAccepted(result: ReminderExecuteResult): boolean {
  return result.kind === "accepted";
}

/**
 * Returns a plain-English note for the consumer to display alongside the result.
 *
 * "accepted"     → null (no extra note needed; display.headline is sufficient)
 * "rejected"     → the rejection note from the display
 * "not_ready"    → a prompt describing which fields are still missing
 * "not_reminder" → null
 */
export function getExecutionNote(result: ReminderExecuteResult): string | null {
  switch (result.kind) {
    case "accepted":
      return null;

    case "rejected":
      return result.display.rejection_note ?? null;

    case "not_ready": {
      const missing = result.missing;
      if (missing.length === 0) return "This reminder is not yet ready to confirm.";
      return `Still needed: ${missing.join(", ")}.`;
    }

    case "not_reminder":
      return null;
  }
}

// ─── Internal formatter ───────────────────────────────────────────────────────

function formatExecutionDisplay(
  artifact: ReminderExecutionArtifact,
): ReminderExecutionDisplay {
  const accepted = artifact.verdict === "accepted";
  return {
    verdict:         artifact.verdict,
    headline:        accepted ? "Reminder accepted" : "Reminder rejected",
    subject:         artifact.subject,
    time_text:       artifact.time_text,
    ...(accepted
      ? {}
      : { rejection_note: artifact.rejection_reason ?? "Could not process this reminder." }),
  };
}
