/**
 * PRV patterns — HIGH-SIGNAL, LEXICAL context-dependency detection only.
 *
 * CONTRACT (PRV / Context Alignment boundary):
 *   PRV is LEXICAL. It fires on the clearest, most unambiguous markers where
 *   the input is obviously dependent on a prior state without exception.
 *
 *   Context Alignment is SEMANTIC. It handles cases where a reference word
 *   might or might not depend on context depending on phrasing.
 *
 * PRV patterns MUST be:
 *   - Unambiguous: the word virtually always references prior state
 *   - Whole-word matched: no substring false positives
 *   - Few: false positives (blocking safe inputs) are worse than false negatives
 *
 * Removed patterns and why:
 *   \bsame\b  — too broad: "I feel the same", "same day delivery" are not context refs.
 *              → Context Alignment handles "same file", "same as before" semantically.
 *   \bthat\b  — too broad: "that's great", "I love that idea" are not context refs.
 *              → Context Alignment handles "that file", "that result" semantically.
 *
 * Kept / narrowed patterns:
 *   \bagain\b      — "run again", "do it again" always reference a prior action
 *   \bcontinue\b   — "continue" always implies something to continue from
 *   \bprevious\b   — "previous run/result" always references prior state
 *   \bsame\s+as\b  — "same as before" is specific enough to be unambiguous
 */
const CONTEXT_DEPENDENCY_PATTERNS = [
    /\bagain\b/i,
    /\bcontinue\b/i,
    /\bprevious\b/i,
    /\bsame\s+as\b/i, // "same as before" — specific; not broad "same"
];
/**
 * Strip quoted string literals from the input before pattern matching.
 * PRV checks structural intent words only — never the user's replacement values.
 * e.g. replace "Submit" with "Continue" → replace "" with "" in <file>
 */
function stripQuotedContent(input) {
    return input.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}
export function requiresContext(input) {
    const stripped = stripQuotedContent(input);
    return CONTEXT_DEPENDENCY_PATTERNS.some((pattern) => pattern.test(stripped));
}
export function hasRequiredContext(ctx) {
    return ctx.hasPriorSession;
}
//# sourceMappingURL=patterns.js.map