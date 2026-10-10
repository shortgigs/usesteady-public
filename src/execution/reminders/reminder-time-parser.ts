/**
 * Reminder time parser — Phase 6, Execution Layer.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * Converts a time_text phrase into a structured ParsedTime.
 * Conservative, regex-only, fully deterministic.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────────
 *
 *   Does NOT produce Date objects or resolved timestamps.
 *   Does NOT assume a default time for day-only phrases.
 *   Does NOT handle timezones.
 *   Does NOT do fuzzy matching or ML-based inference.
 *
 * ── Pattern priority (first match wins) ──────────────────────────────────────
 *
 *   1. relative_offset  — "in N minutes" / "in N hours"
 *   2. day_with_time    — day qualifier + explicit time phrase
 *   3. time_of_day      — explicit time with no day qualifier
 *   4. unresolvable     — anything else (including day qualifier without time)
 *
 * ── Day qualifier without time → unresolvable ────────────────────────────────
 *
 *   "remind me tomorrow" has no time → unresolvable.
 *   The execution layer does not guess a default time.
 *   The caller must surface the missing time to the user.
 */

import type { ParsedTime } from "./reminder-execution-types.js";

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** "in 30 minutes" */
const RELATIVE_MINUTES_RE = /\bin\s+(\d+)\s+minutes?\b/i;

/** "in 2 hours" */
const RELATIVE_HOURS_RE = /\bin\s+(\d+)\s+hours?\b/i;

/**
 * Explicit time phrase: "at 3pm", "at 09:30 am", "at 14:00"
 * Groups: [1]=hour, [2]=minute (optional), [3]=am/pm (optional)
 */
const TIME_OF_DAY_RE = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/**
 * Day qualifier: "tomorrow", "today", "next Monday" … "next Sunday"
 * Captured as a single string for textual preservation.
 */
const DAY_QUALIFIER_RE =
  /\b(tomorrow|today|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TimeParts = {
  hour:   number;
  minute: number;
  period: "am" | "pm" | "24h";
};

function extractTimeParts(match: RegExpExecArray): TimeParts {
  const hour   = parseInt(match[1]!, 10);
  const minute = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const raw    = match[3]?.toLowerCase();
  const period: "am" | "pm" | "24h" =
    raw === "am" ? "am" : raw === "pm" ? "pm" : "24h";
  return { hour, minute, period };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a time_text phrase into a structured ParsedTime.
 *
 * Pure function — same input always produces the same output.
 * Called once inside executeReminder(); the result is passed to
 * validateExecutionRequest(req, parsedTime) to avoid duplicate parsing.
 *
 * @param time_text  The time phrase extracted by the Present Layer, e.g.
 *                   "tomorrow at 9am", "in 30 minutes", "at 3pm".
 */
export function parseTimeText(time_text: string): ParsedTime {
  const input = time_text.trim();

  // ── 1. Relative offset ────────────────────────────────────────────────────

  const relMin = RELATIVE_MINUTES_RE.exec(input);
  if (relMin) {
    return {
      kind:           "relative_offset",
      offset_minutes: parseInt(relMin[1]!, 10),
      basis:          input,
    };
  }

  const relHr = RELATIVE_HOURS_RE.exec(input);
  if (relHr) {
    return {
      kind:           "relative_offset",
      offset_minutes: parseInt(relHr[1]!, 10) * 60,
      basis:          input,
    };
  }

  // ── 2. Day qualifier + time ───────────────────────────────────────────────

  const dayMatch  = DAY_QUALIFIER_RE.exec(input);
  const timeMatch = TIME_OF_DAY_RE.exec(input);

  if (dayMatch && timeMatch) {
    const { hour, minute, period } = extractTimeParts(timeMatch);
    return {
      kind:   "day_with_time",
      day:    dayMatch[1]!.toLowerCase(),
      hour,
      minute,
      period,
    };
  }

  // Day qualifier with no explicit time → unresolvable.
  // We do not guess a default time (e.g. "tomorrow" alone is ambiguous).
  if (dayMatch && !timeMatch) {
    return {
      kind:   "unresolvable",
      reason: `day qualifier "${dayMatch[1]!.toLowerCase()}" present but no time specified`,
    };
  }

  // ── 3. Time of day only (no day qualifier) ────────────────────────────────

  if (timeMatch) {
    const { hour, minute, period } = extractTimeParts(timeMatch);
    return { kind: "time_of_day", hour, minute, period };
  }

  // ── 4. Unresolvable ───────────────────────────────────────────────────────

  return {
    kind:   "unresolvable",
    reason: `could not parse time from: "${input}"`,
  };
}
