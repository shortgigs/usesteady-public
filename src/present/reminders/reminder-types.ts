/**
 * Reminder Presentation Types — Phase 5 / 5C, Present Layer.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * These types represent the PRESENTATION of a reminder-shaped request.
 * They carry structured, consumer-ready data for rendering a reminder UX.
 *
 * ── What these are NOT ────────────────────────────────────────────────────────
 *
 *   NOT execution types      — no scheduled_at, no timer ID, no job reference
 *   NOT storage types        — no persistence keys or mutable state
 *   NOT interpreter types    — no category/confidence from the intake pipeline
 *   NOT completion types     — no mode, no signal, no intentState
 *
 * ── What these ARE ────────────────────────────────────────────────────────────
 *
 *   Pure presentation data.
 *   Consumer-safe: render directly, never act on.
 *   Future-safe: will remain correct when real reminder execution is added later.
 *
 * ── Missing-field contract ────────────────────────────────────────────────────
 *
 *   If a field (subject, time_text) could not be extracted from the input,
 *   it MUST be null. It must NEVER be invented, assumed, or defaulted.
 *   Missing fields are surfaced in missing_fields and rendered as prompts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The presentation state of a reminder.
 *
 *   ready_to_confirm  — subject AND time are present; user can confirm as-is
 *   needs_time        — subject present, time is missing; prompt user for when
 *   needs_subject     — time present, subject is missing; prompt user for what
 *   ambiguous         — insufficient information to determine this is a reminder;
 *                       preserve ambiguity and offer clarify action only
 */
export type ReminderPresentationState =
  | "ready_to_confirm"
  | "needs_time"
  | "needs_subject"
  | "ambiguous";

// ─────────────────────────────────────────────────────────────────────────────
// Confidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How confident the extraction is that this is a reminder request with
 * the stated fields.
 *
 *   explicit   — reminder signal present AND subject AND time extracted
 *   partial    — reminder signal present AND exactly one of subject/time extracted
 *   ambiguous  — reminder signal present but neither subject nor time was clear
 */
export type ReminderConfidence = "explicit" | "partial" | "ambiguous";

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single presentable action for a reminder.
 *
 * ── Presentation-only contract ───────────────────────────────────────────────
 *
 * PresentAction describes what the user CAN do next in the UI.
 * It does NOT execute anything. It does NOT schedule anything.
 *
 *   id       — stable action identifier (used by consumers for routing)
 *   label    — human-readable display string (may vary by state)
 *   enabled  — whether this action is available in the current state
 *
 * Action semantics by state:
 *
 *   ready_to_confirm  → confirm (enabled), edit (enabled), reject (enabled)
 *   needs_time        → confirm (disabled), edit (enabled), reject (enabled)
 *   needs_subject     → confirm (disabled), edit (enabled), reject (enabled)
 *   ambiguous         → confirm (disabled), edit (enabled as "Clarify"), reject (enabled)
 *
 * "confirm" is disabled unless state === "ready_to_confirm" because confirmation
 * of an incomplete or ambiguous reminder would silently discard required fields.
 */
export type PresentAction = {
  readonly id: "confirm" | "edit" | "reject";
  readonly label: string;
  readonly enabled: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Candidate (internal extraction result)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal type — not exported in barrel.
 *
 * Represents the raw extraction result before state + action logic is applied.
 * Used only inside reminder-presenter.ts.
 *
 *   subject          — the task/event extracted from the input (null if not found)
 *   time_text        — the time phrase extracted from the input (null if not found)
 *   recurrence_text  — recurrence phrase if present (null if not found)
 *   confidence       — extraction confidence based on what was found
 */
export type ReminderCandidate = {
  readonly subject:          string | null;
  readonly time_text:        string | null;
  readonly recurrence_text:  string | null;
  readonly confidence:       ReminderConfidence;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main presentation type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ReminderPresentation — the full consumer-ready presentation of a reminder.
 *
 * ── Field guarantees ─────────────────────────────────────────────────────────
 *
 *   kind             — always "reminder" (discriminator for union use)
 *   state            — always set; drives which template the renderer uses
 *   subject          — null if not present in input; never invented
 *   time_text        — null if not present in input; never invented
 *   recurrence_text  — null if not present in input; never invented
 *   confidence       — reflects what was actually extracted, not what was hoped
 *   missing_fields   — names of fields that are null; empty array if all present
 *   actions          — always 3 actions (confirm, edit, reject); enabled varies by state
 *
 * ── Consumer contract ────────────────────────────────────────────────────────
 *
 *   Render subject/time_text/recurrence_text only when non-null.
 *   Show missing_fields as prompts to the user.
 *   Only route "confirm" action when enabled === true.
 *   Never interpret actions as execution triggers.
 */
export type ReminderPresentation = {
  readonly kind:             "reminder";
  readonly state:            ReminderPresentationState;
  readonly subject:          string | null;
  readonly time_text:        string | null;
  readonly recurrence_text:  string | null;
  readonly confidence:       ReminderConfidence;
  readonly missing_fields:   readonly string[];
  readonly actions:          readonly PresentAction[];

  /**
   * boundaryExplanation — Phase 5C metadata.
   *
   * Present when the reminder state warrants a human-readable explanation
   * (e.g. needs_time, needs_subject → not_ready_missing_fields).
   *
   * Zero authority: explains, never routes.
   */
  readonly boundaryExplanation?: import("../boundary-explanation/boundary-explanation-types.js").BoundaryExplanation;
};
