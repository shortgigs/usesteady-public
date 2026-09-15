/**
 * Reminder executor — Phase 6, Execution Layer.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * Orchestrates the execution pipeline for a reminder-shaped request:
 *   buildExecutionRequest  — one-way Present→Execution adapter
 *   executeReminder        — parses, validates, produces artifact
 *
 * ── Dependency direction ──────────────────────────────────────────────────────
 *
 * Execution imports from Present (ReminderPresentation type).
 * Present NEVER imports from Execution.
 * This is a one-way dependency — the Present Layer remains zero-authority.
 *
 * ── Artifact contract ─────────────────────────────────────────────────────────
 *
 * An artifact is always produced — even when validation fails.
 * This gives callers a complete, inspectable provenance record.
 * Downstream schedulers only consume artifacts where verdict === "accepted".
 *
 * ── Parse-once contract ───────────────────────────────────────────────────────
 *
 * parseTimeText is called exactly once inside executeReminder.
 * The ParsedTime result is passed to validateExecutionRequest(req, parsedTime).
 * No duplicate parsing. No drift between validation and artifact construction.
 */

import type { ReminderPresentation } from "../../present/reminders/reminder-types.js";
import type {
  ReminderExecutionRequest,
  ReminderExecutionArtifact,
  ReminderExecutionResult,
} from "./reminder-execution-types.js";
import { parseTimeText }             from "./reminder-time-parser.js";
import { validateExecutionRequest }  from "./reminder-execution-validator.js";

// ─── buildExecutionRequest ────────────────────────────────────────────────────

/**
 * One-way adapter: ReminderPresentation → ReminderExecutionRequest | null.
 *
 * Returns null when the presentation is not ready to execute:
 *   - state !== "ready_to_confirm"
 *   - subject or time_text are missing (null)
 *
 * This is the gating function that prevents executeReminder from ever
 * receiving an incomplete or ambiguous presentation.
 *
 * Note: null here does NOT mean "reject with an artifact". It means the
 * presentation has not reached the execution layer yet — the consumer should
 * prompt the user for the missing field(s) instead.
 *
 * @param presentation  A ReminderPresentation from presentFromInput().
 */
export function buildExecutionRequest(
  presentation: ReminderPresentation,
): ReminderExecutionRequest | null {
  if (presentation.state !== "ready_to_confirm") return null;
  if (presentation.subject === null)             return null;
  if (presentation.time_text === null)           return null;

  return {
    subject:           presentation.subject,
    time_text:         presentation.time_text,
    recurrence_text:   presentation.recurrence_text,
    source_confidence: presentation.confidence,
  };
}

// ─── executeReminder ──────────────────────────────────────────────────────────

/**
 * Execute a validated reminder request.
 *
 * Produces a ReminderExecutionArtifact — the verified, structured record
 * of intent-to-schedule. Does NOT schedule, persist, or notify.
 *
 * Pipeline:
 *   1. parseTimeText(req.time_text)               → ParsedTime (once)
 *   2. validateExecutionRequest(req, parsedTime)  → ExecutionValidation
 *   3. Build artifact (accepted or rejected)
 *
 * @param req   The execution request (from buildExecutionRequest).
 * @param _now  Epoch ms timestamp; defaults to Date.now(). Injectable for tests.
 */
export function executeReminder(
  req:   ReminderExecutionRequest,
  _now:  number = Date.now(),
): ReminderExecutionResult {
  // ── Parse once ────────────────────────────────────────────────────────────
  const parsedTime = parseTimeText(req.time_text);

  // ── Validate ──────────────────────────────────────────────────────────────
  const validation = validateExecutionRequest(req, parsedTime);

  // ── Build artifact ────────────────────────────────────────────────────────
  if (!validation.valid) {
    // For time_unresolvable, the ParsedTime.reason is the most specific
    // explanation — carry it forward in rejection_reason.
    const rejection_reason =
      validation.code === "time_unresolvable" && parsedTime.kind === "unresolvable"
        ? `${validation.reason} (parse detail: ${parsedTime.reason})`
        : validation.reason;

    const artifact: ReminderExecutionArtifact = {
      kind:               "reminder_execution",
      subject:            req.subject,
      time_text:          req.time_text,
      parsed_time:        parsedTime,
      recurrence_text:    req.recurrence_text,
      source_confidence:  req.source_confidence,
      verdict:            "rejected",
      rejection_reason,
      produced_at_ts:     _now,
    };
    return { ok: false, reason: validation.reason, code: validation.code, artifact };
  }

  const artifact: ReminderExecutionArtifact = {
    kind:              "reminder_execution",
    subject:           req.subject,
    time_text:         req.time_text,
    parsed_time:       parsedTime,
    recurrence_text:   req.recurrence_text,
    source_confidence: req.source_confidence,
    verdict:           "accepted",
    produced_at_ts:    _now,
  };
  return { ok: true, artifact };
}
