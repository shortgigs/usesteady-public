/**
 * src/safety/filename-safety.ts
 *
 * Cluster B Iteration 2 — Unified filename + replacement-text safety layer.
 *
 * ── What this module is ───────────────────────────────────────────────────────
 *
 * Cluster B Iteration 1 (alpha.52, PR shortgigs/usesteady-core#297) wired
 * Row 1's `canonicalizeForSafety` into four adjacent surfaces so that any
 * path which is obfuscated to *mask traversal* (e.g. `..\u202E/etc/passwd`)
 * is refused. That iteration closed the path-escape class of obfuscation.
 *
 * It did NOT close two adjacent classes that the same friction wave
 * (Sujith Kamme, May 2026, usesteady-public #50 / #51 / #52) actually
 * reported:
 *
 *   1. Filename-only BIDI / zero-width / control characters.
 *      A path like `src/\u202Ename.ts` does not escape the workspace
 *      (canonical form is `src/name.ts`, still contained), so
 *      `pathEscapesWorkspace` correctly returns `false`. The filename is
 *      created on disk anyway — with a U+202E embedded in the name —
 *      which is itself the security problem the reporter named (file
 *      extension spoofing, display confusion, cross-platform breakage).
 *      Path containment is a NECESSARY check, but it is not the
 *      filename safety check.
 *
 *   2. BIDI / zero-width / control characters in replacement *text*.
 *      The replace-match canonical occurrence-count gate validates
 *      `oldValue` against file content, but the user-supplied `newValue`
 *      is written verbatim. A `to: "Se\u202End"` lands on disk
 *      unsanitized.
 *
 * This module owns the missing checks as **pure functions on flat
 * strings**, matching the Cluster B Iteration 1 style
 * (`pathEscapesWorkspace`, `pathsEqualByCanonical`,
 * `matchesGlobOnBothViews`). It does not introduce a new policy object,
 * a new module hierarchy, or a class boundary — the AGENTS.md rule
 * "no new abstractions without a concrete current user flow
 * requirement" is honoured.
 *
 * ── What this module does NOT do ──────────────────────────────────────────────
 *
 *   - It does not normalize, fold, or rewrite input. Detection only.
 *     Callers refuse the operation; they never substitute a "cleaned"
 *     version on the user's behalf.
 *   - It does not check filesystem state. No `fs` access. Pure transform.
 *   - It does not subsume `pathEscapesWorkspace`. The two predicates are
 *     orthogonal: containment vs. filename hygiene. Both run.
 *   - It does not handle pure-script homograph spoofing (Cyrillic 'а' vs
 *     Latin 'a'). NFKC does not fold scripts. usesteady-public#53
 *     remains `status/accepted` pending a separate script-detection
 *     track, as documented in CHANGELOG.md.
 *   - It does not change the safety-detector contract or the
 *     ControlEnvelope. Cluster B Iteration 2 is additive at the
 *     validate + execute stages only.
 *
 * ── Determinism & fail-closed contract ────────────────────────────────────────
 *
 *   - Pure function: `validateFilenameSafety(s)` returns the same result
 *     for every `s` on every host, every Node version, every call.
 *   - Fail-closed: an input that cannot be classified (non-string,
 *     canonicalization failure) is refused, not silently allowed.
 *   - The result discriminator (`code`) is a closed set, locked at the
 *     type level. Adding a new class of rejection means widening the
 *     union deliberately, not adding a magic-string branch.
 *
 * ── Friction → fix → invariant mapping ────────────────────────────────────────
 *
 *   | Friction (usesteady-public)          | Fix surface (this module)             |
 *   |--------------------------------------|---------------------------------------|
 *   | #50 — U+202E in filename             | validateFilenameSafety (path arg)    |
 *   | #52 — U+202E in replacement text     | validateReplacementTextSafety        |
 *   | #51 — NFC/NFD mismatch (messaging)   | classifyNormalizationDivergence      |
 *                                            (consumed by adapter's replace gate)
 *
 *   See CHANGELOG.md "Cluster B Iteration 2" section for the public
 *   announcement of these closures.
 */
/**
 * Closed set of refusal reasons. Adding a new reason is a deliberate
 * type widening — the call sites' `switch` will fail to compile until
 * they handle the new case.
 *
 * Codes are aligned with `src/input/cli-error.ts:CliErrorCode` so the
 * validator and executor can surface them directly without translation.
 */
export type FilenameSafetyCode = "invalid_filename_chars" | "invalid_filename_canonical_divergence" | "invalid_filename_reserved_name" | "invalid_filename_whitespace" | "canonicalization_failed";
/**
 * Cluster B Iteration 4 -- protected-path refusal code.
 *
 * Returned by `validateProtectedPath`. Kept on a separate type from
 * `FilenameSafetyCode` because the two predicates answer different
 * questions:
 *
 *   - `validateFilenameSafety` answers "is this filename's TEXTUAL form
 *     a safe filename?" (hygiene).
 *   - `validateProtectedPath` answers "is the LOCATION this path points
 *     to one the tool refuses to touch?" (off-limits-regardless-of-shape).
 *
 * A clean ASCII path like `.git/HEAD` passes filename hygiene but is
 * still refused -- the reason is the location, not the spelling.
 *
 * The `reason` discriminator tells the caller which protected-paths
 * rule matched, so future iterations can extend the rule set without
 * breaking call sites' switch exhaustiveness.
 */
export type ProtectedPathCode = "prohibited_path";
export type ProtectedPathReason = "git_internals";
export type ReplacementTextSafetyCode = "invalid_replacement_chars" | "canonicalization_failed";
export type FilenameSafetyResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: FilenameSafetyCode;
    readonly detail: string;
    readonly badCodepoints: readonly string[];
};
export type ReplacementTextSafetyResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: ReplacementTextSafetyCode;
    readonly detail: string;
    readonly badCodepoints: readonly string[];
};
export type ProtectedPathResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: ProtectedPathCode;
    readonly reason: ProtectedPathReason;
    readonly detail: string;
    readonly matchedSegment: string;
};
/**
 * Cluster B Iteration 2 classifier for the existing `ambiguous_match`
 * gate in `inprocess-adapter.receive`. When the canonical and original
 * occurrence counts disagree, this classifier reports *why* — which
 * surfaces a useful error message instead of the opaque
 * "match-count mismatch" string.
 *
 * The classification is consulted *only after* the counts already
 * disagree. It does not change the disposition (still refused); it
 * upgrades the detail.
 */
export type NormalizationDivergenceCause = "unicode_normalization_mismatch" | "hidden_codepoints_in_oldvalue" | "hidden_codepoints_in_content" | "other";
/**
 * Validate that a filename / path is safe to *create* on disk.
 *
 * Refuses paths containing characters that:
 *   - Are invisible (zero-width family).
 *   - Reorder visible glyphs (bidi override family).
 *   - Are control codepoints (U+0001–U+001F except handled-elsewhere
 *     NUL, plus DELETE and C1 controls).
 *   - Canonicalize to a different string (NFKC compatibility folding
 *     produced a divergent identity — fullwidth Latin etc.).
 *
 * This predicate is intentionally orthogonal to `pathEscapesWorkspace`:
 *
 *   - `pathEscapesWorkspace` answers "does this path escape the
 *     workspace boundary?" (containment).
 *   - `validateFilenameSafety` answers "is this path's TEXTUAL form
 *     a safe filename?" (hygiene).
 *
 * Both run. Both must pass. Together they close Cluster B's filename
 * surface fully.
 *
 * Determinism: pure function. No `fs`, no global state, no time.
 *
 * Fail-closed: canonicalization failure is refused, never silently
 * allowed. Matches Row 1's safety-gate contract.
 *
 * @param path  The path as supplied by the user / agent. Treated as
 *              one opaque string; segment-walking is OUT OF SCOPE
 *              for V1 (a single offending codepoint anywhere refuses
 *              the whole path).
 */
export declare function validateFilenameSafety(path: string): FilenameSafetyResult;
/**
 * Validate that a string is safe to *write into a file as replacement
 * text*. Refuses the same character classes as
 * `validateFilenameSafety`, with two differences:
 *
 *   1. Newlines (LF), carriage returns (CR), and tabs (HT) are
 *      ALLOWED. They are legitimate content characters; multi-line
 *      replacements are a normal use case.
 *   2. NFKC canonical-divergence is NOT refused. File content is
 *      allowed to be NFC / NFD / fullwidth / whatever the user
 *      genuinely intends. We refuse only invisible / bidi / control
 *      characters that have no plausible display representation.
 *
 * This closes usesteady-public#52: `to: "Se\u202End"` is refused at
 * the adapter, before the replace is applied.
 */
export declare function validateReplacementTextSafety(text: string): ReplacementTextSafetyResult;
/**
 * Classify the cause of an original-vs-canonical occurrence-count
 * divergence in the replace match gate. Consulted by
 * `inprocess-adapter.receive` *after* the existing gate has already
 * decided to refuse — this function provides the diagnostic, never
 * the disposition.
 *
 * Detection logic:
 *
 *   - If `oldValue` itself contains BIDI / zero-width chars, the
 *     mismatch is caused by hidden codepoints in the search string.
 *   - Else if `content` contains BIDI / zero-width chars near a
 *     would-be match, the file itself is obfuscated.
 *   - Else if `oldValue` is found in canonical form of content but
 *     NOT in original form (or vice versa) via pure NFKC equivalence
 *     (e.g. NFC vs NFD `café`), the mismatch is a Unicode normalization
 *     difference between the search string and the file content. This
 *     is the high-frequency real-developer case (usesteady-public#51).
 *
 * @param oldValue        the search string supplied by the user
 * @param content         the target file's current content
 */
export declare function classifyNormalizationDivergence(oldValue: string, content: string): NormalizationDivergenceCause;
/**
 * Build the human-facing detail message for a divergence cause
 * classified by `classifyNormalizationDivergence`. Used by
 * `inprocess-adapter.receive` to upgrade the existing
 * `ambiguous_match` detail beyond "match-count mismatch".
 */
export declare function describeNormalizationDivergence(cause: NormalizationDivergenceCause, oldValue: string, filePath: string): string;
/**
 * Cluster B Iteration 4 / usesteady-public#60, #67 --
 * protected-path refusal.
 *
 * Refuses operations whose path lands inside a location the tool
 * does not operate on, even when the path itself is well-formed and
 * inside the workspace. Closes two adjacent frictions:
 *
 *   - #60: `create_dir` into `.git/hooks/` plants an executable
 *     git hook outside the user's review surface.
 *   - #67: `delete` of `.git/HEAD` (or any `.git/` internal file)
 *     corrupts the repository silently.
 *
 * Rule (V1, deliberately strict):
 *
 *   ANY path whose split-segments contain a segment that
 *   case-insensitively equals `.git` is refused.
 *
 * Examples that match:
 *   ".git"                          -- the directory itself
 *   ".git/HEAD"                     -- repository state
 *   ".git/hooks/pre-commit"         -- executable hooks
 *   "submodule/.git"                -- submodule pointer file
 *   "nested/.git/index"             -- nested repo's index
 *   ".GIT/HEAD"                     -- Windows case-insensitive
 *   "./.git/config"                 -- relative form
 *
 * Examples that do NOT match (regular workspace files):
 *   ".gitignore"                    -- segment is `.gitignore`, not `.git`
 *   ".gitattributes"                -- same
 *   "docs/git-tutorial.md"          -- segment `git-tutorial.md`
 *   "src/.git-something/foo"        -- segment `.git-something`
 *
 * Why segment-exact match (not prefix or substring):
 *   `.gitignore` is a normal workspace file the user is allowed to
 *   edit. A prefix match `.git*` would refuse it. A substring match
 *   would refuse `.gitignore` and `docs/gitignore-test.md`. Only an
 *   exact-segment match captures "the git internals directory"
 *   without overreaching.
 *
 * Why case-insensitive comparison:
 *   Windows filesystems are case-insensitive by default. `.GIT/HEAD`
 *   resolves to the same on-disk object as `.git/HEAD`. A
 *   case-sensitive check would let a Windows reproducer bypass the
 *   refusal. Linux and macOS-with-APFS-default are case-sensitive,
 *   so the strict comparison ALSO refuses `.GIT` as a distinct
 *   directory there -- but the directory name `.GIT` (uppercase)
 *   on a case-sensitive filesystem is itself confusing enough that
 *   refusing it is not a friction.
 *
 * V1 scope (locked):
 *   - `.git` only. The user's reported frictions are both inside
 *     `.git/`. Extension to other protected paths (`.svn/`, `.hg/`,
 *     `.env*`, `node_modules/`) requires a separate friction signal,
 *     per the AGENTS.md "no new authority without a current user
 *     flow" rule.
 *
 * Determinism: pure function. No fs, no global state. Same input,
 * same output, every host.
 */
export declare function validateProtectedPath(path: string): ProtectedPathResult;
//# sourceMappingURL=filename-safety.d.ts.map