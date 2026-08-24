/**
 * Missing-context ambiguity detector.
 *
 * Detects inputs that contain underspecified references like "the file",
 * "my project", "the config" without a concrete identifier.
 *
 * These inputs are ambiguous because it is not possible to determine
 * which specific artifact is being referenced.
 */
const MISSING_CONTEXT_TERMS = [
    {
        // "the file" is only ambiguous when NOT followed by a concrete path token
        // (quoted, slash-separated, or has a file extension).
        // "rename the file Button.tsx to Y" is specific — don't flag it.
        pattern: /\bthe\s+file\b(?!\s*["']|\s+\S*[./\\]\S*)(?!\s+\S+\.\S+)/i,
        reference: "the file",
        reason: "'the file' does not specify which file. Use a concrete path.",
        options: [
            'replace "..." with "..." in "path/to/file"',
            'rename <current-path> to <new-path>',
        ],
    },
    {
        pattern: /\bmy\s+project\b/i,
        reference: "my project",
        reason: "'my project' does not specify a path. Use a concrete file path.",
        options: [
            'replace "..." with "..." in src/index.ts',
            "rename <old-path> to <new-path>",
        ],
    },
    {
        pattern: /\bthe\s+config\b(?!\s*[".])/i,
        reference: "the config",
        reason: "'the config' does not specify which config file.",
        options: [
            'replace "..." with "..." in tsconfig.json',
            'replace "..." with "..." in package.json',
        ],
    },
];
function findMatch(input) {
    return MISSING_CONTEXT_TERMS.find((entry) => entry.pattern.test(input)) ?? null;
}
export const missingContextDetector = {
    id: "missing_context",
    priority: 30,
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
//# sourceMappingURL=missing-context.detector.js.map