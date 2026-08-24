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
export declare function safetyToSignal(result: SafetyResult): IntakeSignal | null;
export declare function contextAlignmentToSignal(result: ContextAlignmentResult): IntakeSignal | null;
/**
 * `unknown` → null (fall-through; completion is the authority).
 * `clear`   → null (disambiguation confirmed no ambiguity; completion decides).
 * `ambiguous` → signal (explicit short-circuit before completion).
 */
export declare function disambiguationToSignal(result: DisambiguationResult): IntakeSignal | null;
export declare function completionToSignal(result: CompletionResult): IntakeSignal;
//# sourceMappingURL=signal-extractor.d.ts.map