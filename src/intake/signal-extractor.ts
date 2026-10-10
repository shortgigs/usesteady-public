/**
 * Signal extractor — converts layer results into canonical IntakeSignals.
 *
 * Disambiguation note:
 *   `unknown` from disambiguation is NOT converted to a signal.
 *   It returns null (fall-through to completion), matching `clear`.
 *   Rationale: disambiguation `unknown` is an internal intermediate state.
 *   It means "no ambiguity detected." The caller sees only the final outcome.
 *   Completion is the authority on what happens next for unrecognised inputs.
 */

import type { IntakeSignal } from "./types.js";
import type { SafetyResult } from "../safety/types.js";
import type { ContextAlignmentResult } from "../understand/context/types.js";
import type { DisambiguationResult } from "../understand/disambiguation/types.js";
import type { CompletionResult } from "../understand/completion/types.js";

export function safetyToSignal(result: SafetyResult): IntakeSignal | null {
  return result.verdict === "block"
    ? { type: "unsafe", source: "safety" }
    : null;
}

export function contextAlignmentToSignal(
  result: ContextAlignmentResult,
): IntakeSignal | null {
  switch (result.kind) {
    case "non_literal":   return { type: "non_literal",  source: "context" };
    case "hard_mismatch": return { type: "hard_mismatch", source: "context" };
    case "aligned":       return null;
  }
}

/**
 * `unknown` → null (fall-through; completion is the authority).
 * `clear`   → null (disambiguation confirmed no ambiguity; completion decides).
 * `ambiguous` → signal (explicit short-circuit before completion).
 */
export function disambiguationToSignal(
  result: DisambiguationResult,
): IntakeSignal | null {
  switch (result.kind) {
    case "ambiguous": return { type: "ambiguous", source: "disambiguation" };
    case "unknown":   return null;
    case "clear":     return null;
  }
}

export function completionToSignal(result: CompletionResult): IntakeSignal {
  switch (result.kind) {
    case "complete":        return { type: "complete",        source: "completion" };
    case "incomplete":      return { type: "incomplete",      source: "completion" };
    case "guided_recovery": return { type: "guided_recovery", source: "completion" };
  }
}
