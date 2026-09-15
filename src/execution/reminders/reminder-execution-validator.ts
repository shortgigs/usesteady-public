/**
 * Reminder execution validator — Phase 6, Execution Layer.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * Re-validates a ReminderExecutionRequest independently of the presentation.
 * A ready_to_confirm presentation does NOT equal "safe to execute."
 * Every execution request must pass validation before an artifact is produced.
 *
 * ── Parse-once contract ───────────────────────────────────────────────────────
 *
 * validateExecutionRequest(req, parsedTime) accepts the already-parsed ParsedTime.
 * Callers (executeReminder) parse once and pass the result here.
 * This prevents duplicate parsing and drift between validation and artifact.
 *
 * ── subject_unsafe scope ─────────────────────────────────────────────────────
 *
 * The unsafe pattern is intentionally narrow: only obvious destructive/system
 * vocabulary that cannot appear in legitimate reminder subjects.
 *
 * It does NOT match broad "scary" language — words like "cancel", "delete",
 * "remove", or "clear" appear legitimately in reminders:
 *   "remind me to cancel the meeting"
 *   "remind me to delete the temp files"
 *
 * Only multi-word or highly unambiguous destructive patterns are blocked.
 * This mirrors the vocabulary of the existing safety gate, not intent inference.
 */

import type {
  ReminderExecutionRequest,
  ExecutionValidation,
  ParsedTime,
} from "./reminder-execution-types.js";

// ─── Patterns ─────────────────────────────────────────────────────────────────

/**
 * Narrow list of destructive patterns that should not appear in reminder subjects.
 * Same vocabulary style as the safety gate — no broad "scary language" matching.
 *
 * Examples that ARE blocked:
 *   "rm -rf everything", "delete all files", "wipe the database",
 *   "purge all records", "drop table users"
 *
 * Examples that are NOT blocked (legitimate reminder text):
 *   "cancel the meeting", "delete temp files", "clear the whiteboard"
 */
const UNSAFE_SUBJECT_RE =
  /\b(?:rm\s+-rf|delete\s+all|wipe\b|purge\s+all|drop\s+table|format\s+(?:disk|drive|c:|\/dev))\b/i;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a ReminderExecutionRequest against the already-parsed ParsedTime.
 *
 * Returns { valid: true } or { valid: false, reason, code }.
 *
 * Checks in order:
 *   1. subject_empty      — blank or whitespace-only subject
 *   2. subject_unsafe     — subject matches narrow destructive pattern list
 *   3. confidence_too_low — source_confidence === "ambiguous"
 *   4. time_unresolvable  — parsedTime.kind === "unresolvable"
 *
 * @param req        The execution request.
 * @param parsedTime The result of parseTimeText(req.time_text), parsed once by caller.
 */
export function validateExecutionRequest(
  req:        ReminderExecutionRequest,
  parsedTime: ParsedTime,
): ExecutionValidation {
  // 1. Subject must not be empty or whitespace
  if (!req.subject || req.subject.trim().length === 0) {
    return {
      valid:  false,
      reason: "subject is empty or whitespace",
      code:   "subject_empty",
    };
  }

  // 2. Subject must not contain obvious destructive patterns
  if (UNSAFE_SUBJECT_RE.test(req.subject)) {
    return {
      valid:  false,
      reason: "subject contains unsafe content",
      code:   "subject_unsafe",
    };
  }

  // 3. Confidence must not be ambiguous
  if (req.source_confidence === "ambiguous") {
    return {
      valid:  false,
      reason: "source confidence is ambiguous — cannot execute safely",
      code:   "confidence_too_low",
    };
  }

  // 4. Time must have been parseable
  if (parsedTime.kind === "unresolvable") {
    return {
      valid:  false,
      reason: `time_text could not be resolved: ${parsedTime.reason}`,
      code:   "time_unresolvable",
    };
  }

  return { valid: true };
}
