const PATTERNS = [
    { regex: /\bignore\s+(?:the\s+)?rules?\b/i, label: "ignore rules" },
    { regex: /\bwithout\s+approval\b/i, label: "without approval" },
    { regex: /\bsilently\b/i, label: "silently" },
    { regex: /\bbypass\b/i, label: "bypass" },
    // USESTEADY_HOSTILE_SCOPE_DETECTOR_COVERAGE_IMPL_V1 (#845): prompt-injection
    // openers measured as coverage misses in #844. Same evasion_or_rule_bypass
    // intent — additional surface forms only. Appended after the existing patterns
    // so the "ignore rules" first-match label above is preserved.
    { regex: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|earlier|above|preceding)\s+(?:instructions?|prompts?|messages?|directions?|context)\b/i, label: "ignore previous instructions" },
    { regex: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous\s+|prior\s+)?(?:rules?|instructions?|prompts?|guidance)\b/i, label: "disregard rules/instructions" },
];
function findMatch(input) {
    return PATTERNS.find(({ regex }) => regex.test(input)) ?? null;
}
export const evasionDetector = {
    id: "evasion_or_rule_bypass",
    priority: 30,
    supports(input) {
        return findMatch(input) !== null;
    },
    detect(input) {
        const match = findMatch(input);
        if (match === null)
            return null;
        return {
            verdict: "block",
            reason: "evasion_or_rule_bypass",
            matchedPattern: match.label,
            note: "Input contains a pattern associated with policy evasion or rule bypass.",
        };
    },
};
//# sourceMappingURL=evasion.detector.js.map