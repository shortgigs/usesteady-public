/**
 * Completion orchestrator.
 *
 * CONTRACT (written, not implied):
 *   1. Completion is the sole authority on executability.
 *   2. Disambiguation returning `unknown` does NOT block completion from
 *      returning `complete`. The pipeline always reaches completion.
 *   3. Context-dependent executable inputs ("run again") are resolved HERE
 *      when ctx provides the required data. Completion receives full context.
 *   4. Completion never guesses missing values. It returns guided_recovery or
 *      incomplete with explicit next steps when values are absent.
 *
 * Flow:
 *   1. Iterate rules in priority order.
 *   2. First matching non-null result is returned.
 *   3. If no rule matches, fallback guided_recovery is returned.
 *
 * The fallback ensures the function always returns a result — there is no
 * "completion does not know" state. Unknown inputs become guided_recovery.
 */
import type { CompletionResult } from "./types.js";
import type { UnderstandContext } from "../shared/types.js";
import { ALL_COMPLETION_RULES } from "./rules.js";
export declare function runCompletion(input: string, ctx: UnderstandContext): CompletionResult;
export { ALL_COMPLETION_RULES as getCompletionRules };
//# sourceMappingURL=completion.d.ts.map