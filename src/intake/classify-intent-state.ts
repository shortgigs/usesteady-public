/**
 * Intent state classifier — maps IntakeSignals to IntentStates.
 *
 * Deterministic, exhaustive mapping. No logic.
 *
 * `unknown` from disambiguation is no longer a public signal,
 * so there is no case for it here.
 *
 * Mapping:
 *   unsafe          → unsafe
 *   non_literal     → non_literal
 *   hard_mismatch   → ambiguous  (requires clarification)
 *   ambiguous       → ambiguous
 *   incomplete      → incomplete (intent clear, field missing)
 *   guided_recovery → guided_recovery (vague intent, path available)
 *   complete        → clear
 */

import type { IntakeSignal, IntentState } from "./types.js";

export function classifyIntentState(signal: IntakeSignal): IntentState {
  switch (signal.type) {
    case "unsafe":          return "unsafe";
    case "non_literal":     return "non_literal";
    case "hard_mismatch":   return "ambiguous";
    case "ambiguous":       return "ambiguous";
    case "incomplete":      return "incomplete";
    case "guided_recovery": return "guided_recovery";
    case "complete":        return "clear";
  }
}
