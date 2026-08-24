/**
 * Minimal glob matcher for OCD policy checks.
 *
 * Supports the glob features required for cursor integration:
 *   double-star - matches any sequence including path separators
 *   single-star - matches any sequence NOT including path separators
 *   question    - matches exactly one non-separator character
 *
 * Matching rules:
 *   Paths are normalized to forward slashes before matching.
 *   Patterns are anchored (full match required, not substring).
 *   Matching is case-insensitive.
 *
 * See: docs/cursor-allowedfiles-policy.md
 */
/**
 * Return true if filePath matches the given glob pattern.
 *
 * @param filePath  File path to test. Backslashes are normalized to forward slashes.
 * @param pattern   Glob pattern. Supports double-star, single-star, and question-mark.
 */
export declare function matchesGlob(filePath: string, pattern: string): boolean;
/**
 * Convert a glob pattern to an anchored, case-insensitive RegExp.
 *
 * Uses a character-by-character scan to avoid string placeholders that
 * could introduce control characters or confuse source parsers.
 */
export declare function globToRegex(glob: string): RegExp;
//# sourceMappingURL=glob-matcher.d.ts.map