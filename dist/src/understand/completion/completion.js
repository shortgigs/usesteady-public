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
import { ALL_COMPLETION_RULES } from "./rules.js";
// Strip a single leading polite softener so completion rules match
// "please rename X to Y" the same way they match "rename X to Y".
// Mirrors the normalizer's Class 1 stripping in intent.ts.
const POLITE_PREFIX_RE = /^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+need\s+(?:to\s+)?|i\s+want\s+to\s+)/i;
function stripPolitePrefix(input) {
    return input.replace(POLITE_PREFIX_RE, "").trimStart();
}
export function runCompletion(input, ctx) {
    // Normalise polite prefix before rule matching so that
    // "please rename X to Y" and "rename X to Y" reach the same rule.
    const normalised = stripPolitePrefix(input);
    for (const rule of ALL_COMPLETION_RULES) {
        if (rule.matches(normalised, ctx)) {
            const result = rule.evaluate(normalised, ctx);
            if (result !== null)
                return result;
        }
    }
    // Fallback: no rule matched — guide with concrete supported formats.
    // Governance: lists every op in OPERATION_REGISTRY at least once.
    // tests/governance/input-surface-integrity.test.ts asserts this.
    return {
        kind: "guided_recovery",
        reason: "Request does not match a supported deterministic format.",
        missing: ["specific action", "target"],
        nextSteps: [
            { type: "use_exact_format", label: 'replace "<old>" with "<new>" in <file>' },
            { type: "use_exact_format", label: 'append "<text>" to <file>  |  prepend "<text>" to <file>' },
            { type: "use_exact_format", label: "rename <old-path> to <new-path>" },
            { type: "use_exact_format", label: "create file <path>  |  mkdir <path>  |  delete file <path>  |  run <command>" },
        ],
    };
}
export { ALL_COMPLETION_RULES as getCompletionRules };
//# sourceMappingURL=completion.js.map