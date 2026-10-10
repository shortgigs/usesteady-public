/**
 * Reminder Presenter — Phase 5, Present Layer.
 *
 * ── Responsibility ────────────────────────────────────────────────────────────
 *
 * Takes raw input text and produces a ReminderPresentation, or null if the
 * input does not contain sufficient reminder signal.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 *
 *   NOT a new interpreter       — does not enter the intake pipeline
 *   NOT an intake pipeline step — does not affect mode, signal, or intentState
 *   NOT an execution layer      — does not schedule, store, or trigger anything
 *   NOT a UCP participant       — produces no envelopes
 *
 * ── Architecture position ────────────────────────────────────────────────────
 *
 *   Raw input → extractReminderCandidate() → ReminderCandidate | null
 *                                                      ↓
 *                                            presentReminder() → ReminderPresentation | null
 *
 * presentReminder() is the sole public entry point.
 * extractReminderCandidate() is exported for testing; internal to this module.
 *
 * ── Extraction philosophy ────────────────────────────────────────────────────
 *
 *   Conservative: extract only what is EXPLICITLY present.
 *   If a field cannot be cleanly extracted, it becomes null.
 *   Null is never defaulted, assumed, or guessed.
 *   This is a hard contract — the Present Layer does not invent missing facts.
 *
 * ── No interpreter changes ───────────────────────────────────────────────────
 *
 *   This module does not modify the interpreter registry.
 *   It does not affect guided_recovery, incomplete, or any pipeline decision.
 *   Reminder extraction is purely a PRESENTATION-LAYER concern.
 */

import type {
  ReminderCandidate,
  ReminderConfidence,
  ReminderPresentation,
  ReminderPresentationState,
  PresentAction,
} from "./reminder-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Detection — must match before any extraction is attempted
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reminder signal MUST be present before extraction.
 * If this does not match, presentReminder() returns null immediately.
 *
 * Recognised signals (case-insensitive):
 *   "remind me"           — most common
 *   "set a reminder"      — explicit creation verb
 *   "create a reminder"   — explicit creation verb
 *   "add a reminder"      — explicit creation verb
 *
 * Deliberately excluded:
 *   "don't forget"        — too broad; could be a note or instruction
 *   "make sure I"         — too broad; could be many things
 *   "I should remember"   — too indirect
 */
const REMINDER_SIGNAL_RE =
  /\b(remind\s+me|set\s+(?:a\s+)?reminder|create\s+(?:a\s+)?reminder|add\s+(?:a\s+)?reminder)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// Time extraction — ordered from most specific to least specific
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Time patterns, evaluated in priority order.
 * Only the FIRST match is used. More specific patterns come first.
 *
 * What we extract: the entire time phrase as it appears in the input.
 * What we do NOT do: normalise to a timestamp, guess timezone, or assume date.
 *
 * Examples:
 *   "tomorrow morning at 9am"  → "tomorrow morning at 9am"
 *   "tomorrow at 9"            → "tomorrow at 9"
 *   "tomorrow morning"         → "tomorrow morning"
 *   "tomorrow"                 → "tomorrow"
 *   "at 3pm"                   → "at 3pm"
 *   "in 30 minutes"            → "in 30 minutes"
 *   "next Monday"              → "next Monday"
 *   "on Friday"                → "on Friday"
 *   "this morning"             → "this morning"
 */
const TIME_PATTERNS: RegExp[] = [
  // "tomorrow morning/afternoon/evening at HH:MM am/pm" (most specific)
  /\btomorrow\s+(?:morning|afternoon|evening)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  // "tomorrow at HH:MM am/pm"
  /\btomorrow\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  // "tomorrow morning/afternoon/evening"
  /\btomorrow\s+(?:morning|afternoon|evening)\b/i,
  // "tomorrow" alone
  /\btomorrow\b/i,
  // "today morning/afternoon/evening at HH:MM am/pm"
  /\btoday\s+(?:morning|afternoon|evening)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  // "today at HH:MM am/pm"
  /\btoday\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  // "today" alone
  /\btoday\b/i,
  // "at HH:MM am/pm" or "at HH am/pm"
  /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  // "in N minutes/hours/days"
  /\bin\s+\d+\s+(?:minutes?|hours?|days?)\b/i,
  // "next Monday/Tuesday/.../week/month"
  /\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/i,
  // "on Monday/Tuesday/..."
  /\bon\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // "this morning/afternoon/evening/weekend"
  /\bthis\s+(?:morning|afternoon|evening|weekend)\b/i,
];

/**
 * Extract the first matching time phrase from the input.
 * Returns the phrase exactly as it appears in the input.
 * Returns null if no time phrase is found.
 */
function extractTime(input: string): string | null {
  for (const pattern of TIME_PATTERNS) {
    const match = pattern.exec(input);
    if (match) return match[0];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurrence extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract an explicit recurrence phrase if present.
 * Returns the phrase exactly as it appears in the input.
 * Returns null if no recurrence phrase is found.
 *
 * Only "every [X]" patterns are considered recurrence.
 * "daily", "weekly" without "every" are not extracted (too ambiguous without context).
 */
const RECURRENCE_RE =
  /\b(every\s+(?:day|morning|evening|hour|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s+(?:hours?|days?|weeks?|minutes?)))\b/i;

function extractRecurrence(input: string): string | null {
  const match = RECURRENCE_RE.exec(input);
  return match ? match[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subject extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The time boundary regex.
 * Used to clip the subject string at the point where time/recurrence begins.
 * This ensures subject and time do not bleed into each other.
 */
const TIME_BOUNDARY_RE =
  /\s+(?:at\s+\d|tomorrow\b|today\b|in\s+\d|next\s+|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|every\s+|this\s+(?:morning|afternoon|evening|weekend))|[,.]/i;

/**
 * Subject extraction patterns — in priority order.
 *
 * Pattern 1: "remind me to [X]"
 * Pattern 2: "remind me about [X]"
 * Pattern 3: "(set|create|add) a reminder (to|for) [X]"
 *
 * The subject is the text between the signal and the first time/recurrence marker.
 *
 * "remind me" alone (with no following clause) → null (ambiguous, state = "ambiguous")
 */
const SUBJECT_PATTERNS: RegExp[] = [
  // "remind me to [X]"
  /\bremind\s+me\s+to\s+(.+)/i,
  // "remind me about [X]"
  /\bremind\s+me\s+about\s+(.+)/i,
  // "set/create/add a reminder to/for [X]"
  /\b(?:set|create|add)\s+(?:a\s+)?reminder\s+(?:to|for)\s+(.+)/i,
];

/**
 * Extract the subject from the input, given an already-extracted time_text.
 *
 * Strategy:
 *   1. Find the subject candidate text using the SUBJECT_PATTERNS.
 *   2. If time_text is known, clip the candidate just before time_text appears.
 *   3. Otherwise, clip at the first time boundary marker.
 *   4. Return the cleaned subject, or null if it's empty after clipping.
 *
 * This guarantees the subject never contains time information.
 */
function extractSubject(input: string, time_text: string | null): string | null {
  let candidate: string | null = null;

  for (const pattern of SUBJECT_PATTERNS) {
    const match = pattern.exec(input);
    if (match) {
      candidate = match[1] ?? null;
      break;
    }
  }

  if (!candidate) return null;

  // Clip at the known time_text position (exact substring match)
  if (time_text) {
    const idx = candidate.toLowerCase().indexOf(time_text.toLowerCase());
    if (idx === 0) {
      // time_text starts at the very beginning of the candidate —
      // the entire candidate is time, not subject (e.g. "for tomorrow morning")
      candidate = "";
    } else if (idx > 0) {
      candidate = candidate.slice(0, idx);
    } else {
      // time_text not literally in candidate — clip at any time boundary
      const boundaryMatch = TIME_BOUNDARY_RE.exec(candidate);
      if (boundaryMatch) {
        candidate = candidate.slice(0, boundaryMatch.index);
      }
    }
  } else {
    // No time_text known — clip at any time boundary in the candidate
    const boundaryMatch = TIME_BOUNDARY_RE.exec(candidate);
    if (boundaryMatch) {
      candidate = candidate.slice(0, boundaryMatch.index);
    }
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all reminder candidate fields from the raw input.
 *
 * Returns null if no reminder signal is found.
 * Returns a ReminderCandidate with null fields where extraction failed.
 *
 * The confidence level reflects what was successfully extracted:
 *   explicit   = subject AND time present
 *   partial    = exactly one of subject/time present
 *   ambiguous  = signal matched but neither subject nor time found
 *
 * Exported for testing. Not part of the public barrel API.
 */
export function extractReminderCandidate(input: string): ReminderCandidate | null {
  if (!REMINDER_SIGNAL_RE.test(input)) return null;

  const time_text       = extractTime(input);
  const recurrence_text = extractRecurrence(input);
  const subject         = extractSubject(input, time_text);

  const hasSubject = subject !== null;
  const hasTime    = time_text !== null;

  let confidence: ReminderConfidence;
  if (hasSubject && hasTime) confidence = "explicit";
  else if (hasSubject || hasTime) confidence = "partial";
  else confidence = "ambiguous";

  return { subject, time_text, recurrence_text, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// State logic
// ─────────────────────────────────────────────────────────────────────────────

function determineState(candidate: ReminderCandidate): ReminderPresentationState {
  const { subject, time_text, confidence } = candidate;

  // Ambiguous confidence → always ambiguous state regardless of fields
  if (confidence === "ambiguous") return "ambiguous";

  // Both present → ready
  if (subject !== null && time_text !== null) return "ready_to_confirm";

  // Subject only → ask for time
  if (subject !== null && time_text === null) return "needs_time";

  // Time only → ask for subject
  if (subject === null && time_text !== null) return "needs_subject";

  // Fallback (should not be reachable given confidence check above)
  return "ambiguous";
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing fields
// ─────────────────────────────────────────────────────────────────────────────

function buildMissingFields(candidate: ReminderCandidate): readonly string[] {
  const missing: string[] = [];
  if (candidate.subject    === null) missing.push("subject");
  if (candidate.time_text  === null) missing.push("time");
  return missing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the three standard actions for a reminder presentation.
 *
 * ── Action rules ─────────────────────────────────────────────────────────────
 *
 *   confirm   — enabled ONLY when state === "ready_to_confirm"
 *               Requiring both subject and time prevents confirming incomplete data.
 *
 *   edit      — always enabled
 *               Label changes to "Clarify" in ambiguous state to reflect that
 *               the user needs to clarify intent, not just edit known fields.
 *
 *   reject    — always enabled
 *               The user can always dismiss a reminder presentation.
 *
 * These are PRESENTATION descriptors. They do not execute anything.
 * The consumer is responsible for routing action IDs to actual behavior.
 */
function buildActions(state: ReminderPresentationState): readonly PresentAction[] {
  return [
    {
      id:      "confirm",
      label:   "Confirm",
      enabled: state === "ready_to_confirm",
    },
    {
      id:      "edit",
      label:   state === "ambiguous" ? "Clarify" : "Edit",
      enabled: true,
    },
    {
      id:      "reject",
      label:   "Reject",
      enabled: true,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * presentReminder(input) — the sole public function of this module.
 *
 * Takes raw input text and produces a ReminderPresentation, or null if the
 * input does not contain enough reminder signal to justify reminder shaping.
 *
 * ── Return null when ─────────────────────────────────────────────────────────
 *
 *   The input contains no reminder signal (no "remind me", "set a reminder", etc.)
 *   In this case, callers should fall back to existing presentation behavior.
 *
 * ── Return ReminderPresentation when ────────────────────────────────────────
 *
 *   The input contains a reminder signal, even if fields are missing.
 *   The state field tells the consumer how complete the reminder is.
 *   Missing fields are listed in missing_fields.
 *
 * ── Determinism guarantee ────────────────────────────────────────────────────
 *
 *   Same input → same output, always.
 *   No randomness. No session state. No side effects.
 */
export function presentReminder(input: string): ReminderPresentation | null {
  const candidate = extractReminderCandidate(input);
  if (candidate === null) return null;

  const state         = determineState(candidate);
  const missing_fields = buildMissingFields(candidate);
  const actions       = buildActions(state);

  return {
    kind:            "reminder",
    state,
    subject:         candidate.subject,
    time_text:       candidate.time_text,
    recurrence_text: candidate.recurrence_text,
    confidence:      candidate.confidence,
    missing_fields,
    actions,
  };
}
