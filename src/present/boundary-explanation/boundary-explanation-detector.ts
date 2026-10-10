/**
 * Boundary Explanation detector — Phase 5C.
 *
 * Pure, deterministic functions that map already-available state to a
 * BoundaryExplanation.  No re-interpretation, no state mutation.
 *
 * ── Decision order (first-match-wins) ────────────────────────────────────────
 *
 *   1. question_form_needs_action   mode = clarify + question-shaped input
 *   2. multi_intent_first_only      compound-verb input, mode = guide or execute
 *   3. needs_specific_target        mode = guide, guided_recovery, missing file target
 *   4. policy_may_block_target      set by coordinator when 5D contradiction detected
 *      (this detector does not produce it — it requires parsedChange + policy)
 *   5. scope_must_be_narrowed       mode = guide, incomplete, missing fields present
 *   6. not_ready_missing_fields     mode = guide, missing fields present (general fallback)
 *
 *   For the reminder path, detectReminderBoundaryExplanation is used instead.
 *
 * ── Authority constraint ──────────────────────────────────────────────────────
 *
 *   Reads: mode, intentState, guidance.missing, rawInput.
 *   Must not re-run any interpreter or completion logic.
 *   Must not inspect the filesystem or any external environment.
 *   Must not modify any shared state.
 */

import type { IntakeResult } from "../../intake/types.js";
import type { DebugTrace }   from "../../intake/trace.js";
import type { BoundaryExplanation, BoundaryExplanationCode } from "./boundary-explanation-types.js";

// Reminder-specific types are duck-typed here to avoid a circular import.
// The only required fields are `state` and optionally `missing`.
type ReminderLike = {
  readonly state: "ready_to_confirm" | "needs_time" | "needs_subject" | "ambiguous";
  readonly missing?: readonly string[];
};

// ─── Deterministic message catalog ───────────────────────────────────────────

const MESSAGES: Record<BoundaryExplanationCode, string> = {
  question_form_needs_action:
    "This is phrased as a question rather than a command. Rephrase as a direct action — for example, 'Change X to Y in file Z' — to proceed.",
  multi_intent_first_only:
    "This input contains more than one action. Only the first was processed. Submit the remaining actions separately.",
  needs_specific_target:
    "The intent is clear, but the target location is missing. Provide the specific file or value to change.",
  policy_may_block_target:
    "This change is structurally executable, but the target file may be restricted by policy. Review the target before approving.",
  scope_must_be_narrowed:
    "The scope of this change is too broad to act on safely. Narrow to a specific file, section, or value.",
  not_ready_missing_fields:
    "Some required fields are missing. Provide the missing information to complete the request.",
};

// ─── Question-form detection ──────────────────────────────────────────────────

const QUESTION_LEAD = /^(how|what|why|can|is|are|does|do|will|would|should|could|when|where|which)\b/i;

function isQuestionForm(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.endsWith("?") || QUESTION_LEAD.test(trimmed);
}

// ─── Compound-action detection ────────────────────────────────────────────────

const COMPOUND_CONNECTORS = /\b(and|then)\b/i;
// Verbs that indicate deliberate actions (not description verbs like "is", "has").
const ACTION_VERB = /\b(change|update|replace|fix|set|add|remove|delete|deploy|restart|check|run|create|modify|install|enable|disable|toggle|revert|rollback|push|pull|send|export|import|launch|rename|move|copy|reset|apply|configure|upgrade|downgrade|start|stop|kill|flush|migrate|rebuild|clear)\b/gi;

function hasCompoundActions(input: string): boolean {
  if (!COMPOUND_CONNECTORS.test(input)) return false;
  const hits = Array.from(input.matchAll(ACTION_VERB));
  return hits.length >= 2;
}

// ─── Missing file-target detection ───────────────────────────────────────────

const FILE_FIELD_TERMS = /\b(file|path|location|component|module|directory|folder|target|where)\b/i;

function hasMissingFileTarget(intakeResult: IntakeResult): boolean {
  const missing = intakeResult.guidance?.missing ?? [];
  return missing.some(f => FILE_FIELD_TERMS.test(f));
}

// ─── Main detector (intake path) ─────────────────────────────────────────────

/**
 * Detect the single most relevant boundary explanation for an intake result.
 *
 * Returns undefined when no explanation is warranted.
 * Never returns more than one explanation.
 */
export function detectBoundaryExplanation(
  rawInput:     string,
  intakeResult: IntakeResult,
  _trace?:      DebugTrace,
): BoundaryExplanation | undefined {
  const { mode, intentState, guidance } = intakeResult;

  // 1. question_form_needs_action
  if (mode === "clarify" && isQuestionForm(rawInput)) {
    return explain("question_form_needs_action");
  }

  // 2. multi_intent_first_only
  if ((mode === "guide" || mode === "execute") && hasCompoundActions(rawInput)) {
    return explain("multi_intent_first_only");
  }

  // 3. needs_specific_target
  if (mode === "guide" && intentState === "guided_recovery" && hasMissingFileTarget(intakeResult)) {
    return explain("needs_specific_target");
  }

  // 4. policy_may_block_target — NOT produced here; requires parsedChange + policy.
  //    The coordinator injects it after 5D cross-layer detection.

  // 5. scope_must_be_narrowed
  if (mode === "guide" && intentState === "incomplete" && (guidance?.missing.length ?? 0) > 0) {
    return explain("scope_must_be_narrowed");
  }

  // 6. not_ready_missing_fields (guide fallback when missing fields exist)
  if (mode === "guide" && (guidance?.missing.length ?? 0) > 0) {
    return explain("not_ready_missing_fields");
  }

  return undefined;
}

// ─── Reminder path detector ───────────────────────────────────────────────────

/**
 * Detect a boundary explanation for a reminder presentation.
 *
 * Only "not_ready_missing_fields" applies to the reminder path.
 * Other codes are intake-only.
 */
export function detectReminderBoundaryExplanation(
  presentation: ReminderLike,
): BoundaryExplanation | undefined {
  if (presentation.state === "needs_time" || presentation.state === "needs_subject") {
    return explain("not_ready_missing_fields");
  }
  return undefined;
}

// ─── Factory helper ───────────────────────────────────────────────────────────

function explain(code: BoundaryExplanationCode): BoundaryExplanation {
  return { code, message: MESSAGES[code] };
}
