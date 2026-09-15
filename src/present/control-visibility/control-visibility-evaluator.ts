/**
 * Control Visibility Evaluator — Phase 5B.
 *
 * ── Responsibility ────────────────────────────────────────────────────────────
 *
 *   Pure mapping from presentation state → ControlVisibilityResult.
 *
 *   No inference. No guessing. No logic authority.
 *   Every mapping is an explicit, deterministic read of existing state.
 *
 * ── What this does NOT do ─────────────────────────────────────────────────────
 *
 *   Does NOT call intake, execution, or UCP
 *   Does NOT derive new decisions from the presentation
 *   Does NOT change any output shape
 *   Does NOT produce side effects
 *
 * ── Locked rules (permanent — see docs/cvg-baseline.md) ─────────────────────
 *
 *   C1 — CVG is derived only from existing presentation state.
 *        No re-evaluation. No classification. No inference. Pure mapping.
 *
 *   C2 — CVG may assert, but never route.
 *        This function returns a result. It never changes what the caller returns.
 *
 *   C4 — Any new presentation family must extend ControlVisibilityInput here,
 *        add a mapping case below, and pass all uniqueness/invariant tests.
 *        Exhaustive switch required — no default fallthrough.
 *
 * ── Signal mapping summary ────────────────────────────────────────────────────
 *
 *   reminder_presentation:
 *     ready_to_confirm   → signal: "ready_to_confirm",  level: "normal"
 *     needs_time         → signal: "not_ready",          level: "blocking"
 *     needs_subject      → signal: "not_ready",          level: "blocking"
 *     ambiguous          → signal: "ambiguous",          level: "attention"
 *
 *   intake_presentation (by mode):
 *     execute            → signal: "ready_to_confirm",  level: "normal"
 *     guide              → signal: "not_ready",          level: "blocking"
 *     clarify            → signal: "ambiguous",          level: "attention"
 *     refuse             → signal: "refused_execution",  level: "blocking"
 *     ignore             → signal: "not_ready",          level: "blocking"
 *
 *   cursor_preparation:
 *     ready_for_confirmation → signal: "ready_to_confirm",  level: "normal"
 *     conflict_detected      → signal: "conflict_detected", level: "blocking"
 *     not_execute            → signal: "not_ready",          level: "blocking"
 *
 *   cursor_execution:
 *     accepted                       → signal: "ready_to_confirm",  level: "normal"
 *     refused_due_to_scope           → signal: "refused_scope",     level: "blocking"
 *     refused_due_to_execution_error → signal: "refused_execution", level: "blocking"
 *     blocked_ineligible             → signal: "refused_execution", level: "blocking"
 *     blocked_persistence_failure    → signal: "refused_execution", level: "blocking"
 */

import type {
  ControlVisibilityInput,
  ControlVisibilityResult,
  ControlSignal,
  ControlSignalLevel,
} from "./control-visibility-types.js";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate the control visibility for a given presentation input.
 *
 * Pure function. No side effects. No inference. Deterministic.
 *
 * @param input  A ControlVisibilityInput discriminated union arm.
 * @returns      A ControlVisibilityResult characterizing the authority level.
 */
// ─── Signal mapping summary addendum (Phase 5D) ──────────────────────────────
//
//   intake_provisionally_executable:
//     → signal: "provisionally_executable", level: "attention"
//     → must_block_confirm: false (does not hard-block)
//     → must_surface: true (H must see the warning)
//     → must_differentiate: true
//
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateControlVisibility(
  input: ControlVisibilityInput,
): ControlVisibilityResult {
  switch (input.kind) {
    case "reminder_presentation":
      return fromReminderState(input.presentation.state);

    case "intake_presentation":
      return fromIntakeMode(input.presentation.mode);

    case "cursor_preparation":
      return fromCursorPreparation(input.result.kind);

    case "cursor_execution":
      return fromCursorExecution(input.result.kind);

    case "intake_provisionally_executable":
      // Phase 5D — structurally executable but downstream policy block likely.
      // attention level: must surface, must NOT hard-block confirm.
      return build("provisionally_executable", "attention");
  }
}

// ─── Internal mappers ─────────────────────────────────────────────────────────

function fromReminderState(
  state: "ready_to_confirm" | "needs_time" | "needs_subject" | "ambiguous",
): ControlVisibilityResult {
  switch (state) {
    case "ready_to_confirm": return build("ready_to_confirm",  "normal");
    case "needs_time":       return build("not_ready",          "blocking");
    case "needs_subject":    return build("not_ready",          "blocking");
    case "ambiguous":        return build("ambiguous",          "attention");
  }
}

function fromIntakeMode(
  mode: "refuse" | "ignore" | "clarify" | "guide" | "execute",
): ControlVisibilityResult {
  switch (mode) {
    case "execute": return build("ready_to_confirm",  "normal");
    case "guide":   return build("not_ready",          "blocking");
    case "clarify": return build("ambiguous",          "attention");
    case "refuse":  return build("refused_execution",  "blocking");
    case "ignore":  return build("not_ready",          "blocking");
  }
}

function fromCursorPreparation(
  kind: "ready_for_confirmation" | "conflict_detected" | "not_execute",
): ControlVisibilityResult {
  switch (kind) {
    case "ready_for_confirmation": return build("ready_to_confirm",  "normal");
    case "conflict_detected":      return build("conflict_detected", "blocking");
    case "not_execute":            return build("not_ready",          "blocking");
  }
}

function fromCursorExecution(
  kind:
    | "accepted"
    | "refused_due_to_scope"
    | "refused_due_to_execution_error"
    | "blocked_ineligible"
    | "blocked_persistence_failure",
): ControlVisibilityResult {
  switch (kind) {
    case "accepted":                       return build("ready_to_confirm",  "normal");
    case "refused_due_to_scope":           return build("refused_scope",     "blocking");
    case "refused_due_to_execution_error": return build("refused_execution", "blocking");
    case "blocked_ineligible":             return build("refused_execution", "blocking");
    case "blocked_persistence_failure":    return build("refused_execution", "blocking");
  }
}

// ─── Result builder ───────────────────────────────────────────────────────────

/**
 * Derive the three boolean flags from level.
 *
 *   blocking:  must_block_confirm=true,  must_surface=true,  must_differentiate=true
 *   attention: must_block_confirm=false, must_surface=true,  must_differentiate=true
 *   normal:    must_block_confirm=false, must_surface=false, must_differentiate=true
 *
 * Higher-authority signals subsume lower-authority flags.
 * must_differentiate is always true — no two levels may be visually equivalent.
 */
function build(signal: ControlSignal, level: ControlSignalLevel): ControlVisibilityResult {
  switch (level) {
    case "blocking":
      return { level, signal, must_block_confirm: true,  must_surface: true,  must_differentiate: true };
    case "attention":
      return { level, signal, must_block_confirm: false, must_surface: true,  must_differentiate: true };
    case "normal":
      return { level, signal, must_block_confirm: false, must_surface: false, must_differentiate: true };
  }
}
