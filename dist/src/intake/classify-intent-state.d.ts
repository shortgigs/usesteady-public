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
export declare function classifyIntentState(signal: IntakeSignal): IntentState;
//# sourceMappingURL=classify-intent-state.d.ts.map