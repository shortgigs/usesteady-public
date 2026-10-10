/**
 * Reminder Renderer — Phase 5, Present Layer.
 *
 * ── Responsibility ────────────────────────────────────────────────────────────
 *
 * Takes a ReminderPresentation (already-built by the presenter) and produces
 * a RenderedReminder — the human-readable string output ready for display.
 *
 * ── What this does NOT do ─────────────────────────────────────────────────────
 *
 *   Does NOT invent new information      — renders only what the presentation has
 *   Does NOT execute anything            — pure string formatting
 *   Does NOT make decisions              — all state logic is in reminder-presenter.ts
 *   Does NOT produce HTML or markup      — plain structured text only
 *
 * ── Rendering contract ────────────────────────────────────────────────────────
 *
 *   RenderedReminder is the final consumer-facing shape.
 *   All fields are plain strings (or null where absent).
 *   Consumers may combine them in any layout they choose.
 *
 *   headline     — always present; the top line
 *   body         — lines describing known fields (subject, time, recurrence)
 *                  array is empty when nothing is known yet
 *   prompt       — the question to ask the user for missing fields
 *                  null when state === "ready_to_confirm" (nothing is missing)
 *   actions_label — a single formatted string like "Confirm · Edit · Reject"
 *                  only includes ENABLED actions
 *   missing      — copy of missing_fields from the presentation for convenience
 *
 * ── Template logic ────────────────────────────────────────────────────────────
 *
 *   Case A (ready_to_confirm):
 *     headline: "Reminder"
 *     body:     "Task: {subject}" / "Time: {time}" / "Repeats: {recurrence}"
 *     prompt:   null
 *     actions:  "Confirm · Edit · Reject"
 *
 *   Case B (needs_time):
 *     headline: "Reminder (incomplete)"
 *     body:     "Task: {subject}"
 *     prompt:   "When should this reminder trigger?"
 *     actions:  "Edit · Reject"
 *
 *   Case C (needs_subject):
 *     headline: "Reminder (incomplete)"
 *     body:     "Time: {time}" / "Repeats: {recurrence}"
 *     prompt:   "What should this reminder be for?"
 *     actions:  "Edit · Reject"
 *
 *   Case D (ambiguous):
 *     headline: "Possible reminder"
 *     body:     [] (empty — nothing is confirmed)
 *     prompt:   "Is this a reminder? If so, what would you like to be reminded about, and when?"
 *     actions:  "Clarify · Reject"
 */

import type { ReminderPresentation } from "./reminder-types.js";
import {
  evaluateControlVisibility,
  assertControlVisibilityConsistency,
} from "../control-visibility/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Output type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RenderedReminder — the final display-ready shape.
 *
 *   headline      — the primary heading line
 *   body          — array of detail lines (Task, Time, Repeats)
 *                   each line is a complete display-ready string
 *   prompt        — what to ask the user next; null if nothing is missing
 *   actions_label — display string of enabled actions joined by " · "
 *   missing       — mirror of ReminderPresentation.missing_fields
 */
export type RenderedReminder = {
  readonly headline:      string;
  readonly body:          readonly string[];
  readonly prompt:        string | null;
  readonly actions_label: string;
  readonly missing:       readonly string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * renderReminder(presentation) — convert a ReminderPresentation to display strings.
 *
 * Deterministic: same ReminderPresentation → same RenderedReminder, always.
 * No side effects. No decisions. Pure formatting.
 */
export function renderReminder(p: ReminderPresentation): RenderedReminder {
  // CVG read-only hook — compute and assert, output shape unchanged.
  const cvg = evaluateControlVisibility({ kind: "reminder_presentation", presentation: p });
  assertControlVisibilityConsistency(cvg);

  // Build the actions label from enabled actions only
  const actions_label = p.actions
    .filter((a) => a.enabled)
    .map((a) => a.label)
    .join(" · ");

  switch (p.state) {

    // ── Case A: ready_to_confirm ────────────────────────────────────────────
    case "ready_to_confirm": {
      const body: string[] = [];
      // subject and time_text are guaranteed non-null in ready_to_confirm
      // (state logic in reminder-presenter.ts ensures this)
      if (p.subject         !== null) body.push(`Task: ${p.subject}`);
      if (p.time_text       !== null) body.push(`Time: ${p.time_text}`);
      if (p.recurrence_text !== null) body.push(`Repeats: ${p.recurrence_text}`);

      return {
        headline:      "Reminder",
        body,
        prompt:        null,
        actions_label,
        missing:       p.missing_fields,
      };
    }

    // ── Case B: needs_time ──────────────────────────────────────────────────
    case "needs_time": {
      const body: string[] = [];
      if (p.subject !== null) body.push(`Task: ${p.subject}`);

      return {
        headline:      "Reminder (incomplete)",
        body,
        prompt:        "When should this reminder trigger?",
        actions_label,
        missing:       p.missing_fields,
      };
    }

    // ── Case C: needs_subject ───────────────────────────────────────────────
    case "needs_subject": {
      const body: string[] = [];
      if (p.time_text       !== null) body.push(`Time: ${p.time_text}`);
      if (p.recurrence_text !== null) body.push(`Repeats: ${p.recurrence_text}`);

      return {
        headline:      "Reminder (incomplete)",
        body,
        prompt:        "What should this reminder be for?",
        actions_label,
        missing:       p.missing_fields,
      };
    }

    // ── Case D: ambiguous ───────────────────────────────────────────────────
    case "ambiguous": {
      return {
        headline:      "Possible reminder",
        body:          [],
        prompt:        "Is this a reminder? If so, what would you like to be reminded about, and when?",
        actions_label,
        missing:       p.missing_fields,
      };
    }
  }
}
