/**
 * Reminder Execution Types — Phase 6, Execution Layer.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * These types represent the execution pipeline for a reminder-shaped request.
 * They are distinct from the presentation types (Phase 5) and operate at a
 * different layer of the system.
 *
 * ── Layer boundaries ──────────────────────────────────────────────────────────
 *
 *   Present Layer (Phase 5) → describes what to show
 *   Execution Layer (Phase 6) → validates and produces a verified execution record
 *
 * The Execution Layer does NOT trust the Present Layer blindly.
 * It re-validates independently before producing any artifact.
 *
 * ── What this layer does NOT do ───────────────────────────────────────────────
 *
 *   NOT scheduling     — no OS/calendar scheduling
 *   NOT persisting     — no reminder storage
 *   NOT delivering     — no notification sending
 *   NOT resolving tz   — no timezone handling
 *   NOT date math      — "tomorrow" stays "tomorrow", never becomes a Date
 *
 * ── Artifact is the product ───────────────────────────────────────────────────
 *
 *   ReminderExecutionArtifact is what downstream scheduling integrations consume.
 *   It is the verified, structured record of intent-to-schedule.
 *   An artifact is always produced — even on rejection — for complete provenance.
 *
 * ── Parse-once rule ───────────────────────────────────────────────────────────
 *
 *   parseTimeText() is called exactly once inside executeReminder().
 *   The ParsedTime result is passed into validateExecutionRequest(req, parsedTime).
 *   This prevents duplicate parsing and drift between validation and artifact.
 */

import type { ReminderConfidence } from "../../present/reminders/reminder-types.js";

// ─── Request ──────────────────────────────────────────────────────────────────

/**
 * Input to the execution layer.
 *
 * Built from a ReminderPresentation by buildExecutionRequest().
 * Only created when presentation.state === "ready_to_confirm".
 *
 * source_confidence is preserved from the presentation — it influences
 * validation and is included in the artifact for provenance.
 */
export type ReminderExecutionRequest = {
  readonly subject:           string;
  readonly time_text:         string;
  readonly recurrence_text:   string | null;
  readonly source_confidence: ReminderConfidence;
};

// ─── Parsed time ──────────────────────────────────────────────────────────────

/**
 * Structured intermediate from parseTimeText().
 *
 * ── Determinism contract ─────────────────────────────────────────────────────
 *
 *   ParsedTime contains ONLY the structural parse result.
 *   It does NOT contain resolved timestamps or Date objects.
 *   "tomorrow" stays "tomorrow" — downstream schedulers resolve relative
 *   qualifiers against their own time context.
 *
 * ── Kinds ────────────────────────────────────────────────────────────────────
 *
 *   time_of_day      "at 3pm", "at 09:30 am"
 *   relative_offset  "in 30 minutes", "in 2 hours"
 *   day_with_time    "tomorrow at 9am", "next monday at 2pm"
 *                    day is textual — never normalised to a weekday number or Date
 *   unresolvable     anything else, or a day qualifier with no time phrase
 */
export type ParsedTime =
  | {
      readonly kind:    "time_of_day";
      readonly hour:    number;
      readonly minute:  number;
      /** "24h" when no am/pm suffix was present. */
      readonly period:  "am" | "pm" | "24h";
    }
  | {
      readonly kind:            "relative_offset";
      readonly offset_minutes:  number;
      /** The original phrase for provenance, e.g. "in 30 minutes". */
      readonly basis:           string;
    }
  | {
      readonly kind:    "day_with_time";
      /**
       * Textual day qualifier as it appeared in the input, lowercased.
       * Examples: "tomorrow", "today", "next monday", "next friday".
       * Never normalised to a date or weekday number.
       */
      readonly day:     string;
      readonly hour:    number;
      readonly minute:  number;
      readonly period:  "am" | "pm" | "24h";
    }
  | {
      readonly kind:    "unresolvable";
      /** Human-readable reason why the time could not be parsed. */
      readonly reason:  string;
    };

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * The four rejection codes for this slice.
 *
 * presentation_incomplete is intentionally absent:
 *   buildExecutionRequest() returns null for incomplete presentations,
 *   so executeReminder() is never called with one.
 */
export type ExecutionRejectionCode =
  | "subject_empty"
  | "subject_unsafe"
  | "time_unresolvable"
  | "confidence_too_low";

export type ExecutionValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string; readonly code: ExecutionRejectionCode };

// ─── Artifact ─────────────────────────────────────────────────────────────────

/**
 * ReminderExecutionArtifact — the verified, structured record of intent-to-schedule.
 *
 * ── What it is ───────────────────────────────────────────────────────────────
 *
 *   The product of the execution layer. Downstream schedulers consume this
 *   to actually create a reminder. The execution layer itself does not schedule.
 *
 * ── Always produced ──────────────────────────────────────────────────────────
 *
 *   An artifact is produced even on rejection. This gives callers a complete
 *   provenance record regardless of outcome.
 *
 * ── Field contracts ──────────────────────────────────────────────────────────
 *
 *   time_text         — the original phrase from the request (preserved for mapper)
 *   parsed_time       — the full structural parse result (for downstream schedulers)
 *   source_confidence — from the presentation; part of why accepted/rejected
 *   rejection_reason  — present when verdict === "rejected"; for unresolvable time,
 *                       this carries ParsedTime.reason for full context
 *   produced_at_ts    — epoch ms; injectable via _now parameter for deterministic tests
 */
export type ReminderExecutionArtifact = {
  readonly kind:               "reminder_execution";
  readonly subject:            string;
  readonly time_text:          string;
  readonly parsed_time:        ParsedTime;
  readonly recurrence_text:    string | null;
  readonly source_confidence:  ReminderConfidence;
  readonly verdict:            "accepted" | "rejected";
  readonly rejection_reason?:  string;
  readonly produced_at_ts:     number;
};

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * ReminderExecutionResult — the discriminated result of executeReminder().
 *
 * Both arms carry the artifact for complete provenance.
 */
export type ReminderExecutionResult =
  | {
      readonly ok:       true;
      readonly artifact: ReminderExecutionArtifact;
    }
  | {
      readonly ok:       false;
      readonly reason:   string;
      readonly code:     ExecutionRejectionCode;
      readonly artifact: ReminderExecutionArtifact;
    };
