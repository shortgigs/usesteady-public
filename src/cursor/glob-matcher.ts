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
export function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const regex          = globToRegex(pattern);
  return regex.test(normalizedPath);
}

/**
 * Convert a glob pattern to an anchored, case-insensitive RegExp.
 *
 * Uses a character-by-character scan to avoid string placeholders that
 * could introduce control characters or confuse source parsers.
 */
export function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/");
  const ESCAPE_RE  = /[.+^${}()|[\]\\]/g;

  let pattern = "";
  let i       = 0;

  while (i < normalized.length) {
    const ch = normalized[i] as string;

    if (ch === "*" && normalized[i + 1] === "*") {
      // "**" followed by "/" means zero or more directory components (including none).
      // e.g. "**/.env*" must match root-level ".env.local" and "config/.env.local".
      if (normalized[i + 2] === "/") {
        pattern += "(.*/)?";
        i       += 3; // consume **/ together
      } else {
        // "**" at end of pattern or not followed by "/" — any chars including separators
        pattern += ".*";
        i       += 2;
      }
    } else if (ch === "*") {
      pattern += "[^/]*";
      i       += 1;
    } else if (ch === "?") {
      pattern += "[^/]";
      i       += 1;
    } else {
      pattern += ch.replace(ESCAPE_RE, "\\$&");
      i       += 1;
    }
  }

  return new RegExp(`^${pattern}$`, "i");
}
