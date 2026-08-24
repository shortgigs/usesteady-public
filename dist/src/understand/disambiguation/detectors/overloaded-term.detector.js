/**
 * Overloaded term detector.
 *
 * Detects inputs that contain terms with multiple well-known meanings
 * in a development/tooling context.
 *
 * Examples:
 *   "latest change"  → latest git commit? latest file modification? latest test run?
 *   "change button"  → change button text? change button color? change button behavior?
 */
const OVERLOADED_TERMS = [
    // NOTE: "latest change" / "show latest change" was removed from here.
    // Completion handles it deterministically as `incomplete` with a specific
    // next step ("show last commit"). Disambiguation should not intercept inputs
    // that completion can resolve with a concrete path.
    {
        // Only fire when the user has NOT specified what to change (e.g. not "change button text"
        // or "change button color") — those are partially resolved and fall through to guided_recovery.
        pattern: /\bchange\s+(the\s+)?button\b(?!\s+(?:text|color|colour|label|style|class))/i,
        term: "change button",
        reason: "'change button' is ambiguous: text, color, behavior, or handler are all valid targets.",
        options: [
            'replace "old text" with "new text" in button component',
            'replace "old-class" with "new-class" in button component',
        ],
    },
    {
        pattern: /\b(update|modify|change)\s+(the\s+)?config\b/i,
        term: "change config",
        reason: "'change config' is ambiguous: which config file and which field are unspecified.",
        options: [
            'replace "old-value" with "new-value" in config.json',
            'replace "old-value" with "new-value" in tsconfig.json',
        ],
    },
];
function findMatch(input) {
    return OVERLOADED_TERMS.find((entry) => entry.pattern.test(input)) ?? null;
}
export const overloadedTermDetector = {
    id: "overloaded_term",
    priority: 20,
    supports(input) {
        return findMatch(input) !== null;
    },
    detect(input) {
        const entry = findMatch(input);
        if (entry === null)
            return null;
        return {
            kind: "ambiguous",
            reason: entry.reason,
            options: entry.options,
        };
    },
};
//# sourceMappingURL=overloaded-term.detector.js.map