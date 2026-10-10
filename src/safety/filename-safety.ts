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

import { canonicalizeForSafety, CanonicalizationError } from "./canonicalize.js";

// ─── Codepoint classification ────────────────────────────────────────────────
//
// The classes we refuse in filenames AND in replacement text. Source of
// truth for the codepoint sets — `canonicalize.ts` strips these during
// detector canonicalization, but here we DETECT them in the original
// form because:
//
//   1. The OS sees the original codepoints. Stripping is a detector
//      view, not a runtime substitution.
//   2. We refuse *all* uses, not just bypass attempts. A filename
//      legitimately containing U+202E is also broken display-wise; we
//      surface it to the user instead of silently writing it.
//
// Tight scope: only codepoints whose presence in a filename is almost
// never legitimate developer intent. We deliberately do NOT reject
// general non-ASCII (Unicode letters, accented characters, CJK, emoji
// are all allowed — they are normal in real codebases). The
// classification is "invisible / display-reordering / control", not
// "non-Latin".

/**
 * Zero-width / invisible-glue codepoints. Same set as
 * `canonicalize.ts:ZERO_WIDTH_CHARS` — single source of truth would
 * require exporting from canonicalize.ts, but we duplicate the regex
 * here because (a) canonicalize.ts uses the regex with the `g` flag
 * (stateful, not safe to share across `.test()` callers) and (b)
 * the two modules have distinct semantics: canonicalize STRIPS,
 * filename-safety REJECTS. Keeping them syntactically aligned and
 * locking the alignment via a test is safer than cross-importing
 * a stateful RegExp.
 */
const ZERO_WIDTH_CODEPOINTS = /[\u200B\u200C\u200D\u2060\uFEFF]/;

/**
 * Bidirectional override / isolate / mark codepoints. Same set as
 * `canonicalize.ts:BIDI_CONTROL_CHARS`. See note on
 * `ZERO_WIDTH_CODEPOINTS` re: deliberate duplication.
 */
const BIDI_CONTROL_CODEPOINTS =
  /[\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/;

/**
 * ASCII / C0 control codepoints (U+0000–U+001F) except tab/newline/CR,
 * plus the C1 control block (U+0080–U+009F), plus DELETE (U+007F).
 *
 * Tab / newline / CR are excluded here because:
 *   - U+0000 (NUL) is already refused at a separate stage by
 *     `checkPathBytes` in `feasibility-validator.ts` (S1 / #26). Not
 *     part of filename-safety's surface — it's a path-byte-layer
 *     concern. We deliberately do NOT re-detect NUL here to keep the
 *     two stages' error codes orthogonal (NUL → invalid_path, control
 *     codepoints → invalid_filename_chars).
 *   - Newlines / tabs CAN appear in legitimate file content. They
 *     never appear in filenames on a sane OS, but the validation
 *     surfaces below scope this regex strictly to PATH inputs; the
 *     replacement-text validator uses a different (stricter on
 *     control, lenient on whitespace) regex.
 */
const PATH_CONTROL_CODEPOINTS = /[\u0001-\u001F\u007F-\u009F]/;

/**
 * Replacement-text control codepoints. Same as
 * `PATH_CONTROL_CODEPOINTS` minus tab (U+0009), LF (U+000A), and
 * CR (U+000D). A replacement string that legitimately includes
 * newlines (multi-line edits) must be allowed; only invisible
 * control / format characters that have no visual representation
 * are refused.
 */
const REPLACEMENT_TEXT_CONTROL_CODEPOINTS =
  /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// ─── Windows reserved device names (Cluster B Iteration 3) ───────────────────
//
// The canonical Windows reserved device name set per Microsoft's official
// documentation (Naming Files, Paths, and Namespaces):
// https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
//
// Refusal is cross-platform, not Windows-only. A repository containing a
// reserved-name file cannot be cloned, archived, or extracted on Windows
// even when authored on Linux or macOS — so the repository-level hazard
// applies on every host, and the check runs on every host.
//
// Match semantics (case-insensitive):
//   - Every path segment (split on `/` or `\`, empties dropped) is
//     checked, not only the basename. A reserved parent directory
//     like `src/NUL/file.ts` is refused at validation time
//     (usesteady-public#78).
//   - Per segment: trailing dots and spaces are stripped (Windows
//     silently strips these when resolving names).
//   - The first dot-separated segment of the stripped segment is the
//     "device-name candidate" — `CON`, `CON.txt`, `CON.tsx.bak` all
//     have candidate `CON`.
//   - The candidate is compared (case-insensitively) against the
//     reserved set.
//
// Why a Set, not a regex: discrete membership, O(1) lookup, easier to
// extend with a future allowlist field. The set is locked by the
// Microsoft documentation and has not changed in 30+ years.
const WINDOWS_RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// ─── Result type ─────────────────────────────────────────────────────────────

/**
 * Closed set of refusal reasons. Adding a new reason is a deliberate
 * type widening — the call sites' `switch` will fail to compile until
 * they handle the new case.
 *
 * Codes are aligned with `src/input/cli-error.ts:CliErrorCode` so the
 * validator and executor can surface them directly without translation.
 */
export type FilenameSafetyCode =
  | "invalid_filename_chars"        // path contains BIDI / zero-width / control codepoints
  | "invalid_filename_canonical_divergence"  // path canonicalizes to a different string
  | "invalid_filename_reserved_name"  // basename matches a Windows reserved device name (Iter 3)
  | "invalid_filename_whitespace"   // a path segment has leading/trailing whitespace (Iter 4 / public#68)
  | "canonicalization_failed";      // input could not be canonicalized at all

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

export type ReplacementTextSafetyCode =
  | "invalid_replacement_chars"     // text contains BIDI / zero-width / control codepoints
  | "canonicalization_failed";

export type FilenameSafetyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: FilenameSafetyCode;
      readonly detail: string;
      readonly badCodepoints: readonly string[];
    };

export type ReplacementTextSafetyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: ReplacementTextSafetyCode;
      readonly detail: string;
      readonly badCodepoints: readonly string[];
    };

export type ProtectedPathResult =
  | { readonly ok: true }
  | {
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
export type NormalizationDivergenceCause =
  | "unicode_normalization_mismatch"  // NFC vs NFD, fullwidth/compat variants
  | "hidden_codepoints_in_oldvalue"   // oldValue contains BIDI/zero-width
  | "hidden_codepoints_in_content"    // file content contains BIDI/zero-width
  | "other";

// ─── Public API ──────────────────────────────────────────────────────────────

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
export function validateFilenameSafety(path: string): FilenameSafetyResult {
  if (typeof path !== "string") {
    return {
      ok: false,
      code: "canonicalization_failed",
      detail:
        "Filename input is not a string — UseSteady refused this safely " +
        "because it could not be validated. This indicates an internal " +
        "caller bug; please report it with the failing input shape.",
      badCodepoints: [],
    };
  }

  const offenders = collectOffenders(path, [
    { regex: ZERO_WIDTH_CODEPOINTS,    label: "zero-width" },
    { regex: BIDI_CONTROL_CODEPOINTS,  label: "bidi-control" },
    { regex: PATH_CONTROL_CODEPOINTS,  label: "control" },
  ]);

  if (offenders.length > 0) {
    return {
      ok: false,
      code: "invalid_filename_chars",
      detail: buildOffenderDetail(
        "Filename",
        offenders,
        "Filenames with invisible, bidirectional, or control codepoints are " +
          "refused because they cause display confusion, file extension " +
          "spoofing, and cross-platform breakage. Rename without the listed " +
          "codepoints to proceed.",
      ),
      badCodepoints: offenders.map(formatCodepoint),
    };
  }

  // Cluster B Iteration 3 - Windows reserved device name refusal.
  // Runs BEFORE canonicalization because the check is a cheap string
  // match and produces a more specific error code than NFKC divergence
  // (a reserved name is reserved whether or not it canonicalizes).
  //
  // Runs BEFORE the Iter 4 whitespace check too: a basename like
  // "CON " already trips the reserved-name matcher (which strips
  // trailing dots/spaces internally to mirror Windows resolution),
  // and its detail message is more actionable than the whitespace
  // one ("rename to CON-utils" beats "rename to CON" -- the trimmed
  // form is itself reserved). The whitespace check picks up the
  // non-reserved cases the reserved matcher does not match (leading
  // whitespace, intermediate-segment whitespace, basenames that
  // aren't reserved after trimming).
  const reservedHit = matchWindowsReservedName(path);
  if (reservedHit !== null) {
    // Iter 3.6: derive a concrete rename example from the offending
    // basename so the user gets a copy-pasteable fix in line, not just
    // an abstract instruction. `con.ts` → `con-utils.ts`, `AUX.md` →
    // `AUX-utils.md`. Preserves the original extension when present.
    // Drives off the *full* basename of the input path (not just
    // `reservedHit.candidate`, which is the device-name segment) so the
    // extension survives.
    const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const fullBasename = lastSep >= 0 ? path.slice(lastSep + 1) : path;
    const renameTarget = reservedHit.isBasename ? fullBasename : reservedHit.matchedSegment;
    const renameExample = suggestReservedNameRename(renameTarget);
    const reservedDetail = reservedHit.isBasename
      ? (
        `Filename "${path}" resolves to the Windows reserved device name ` +
        `"${reservedHit.deviceName}" (basename: "${reservedHit.candidate}"). `
      )
      : (
        `Filename "${path}" resolves to the Windows reserved device name ` +
        `"${reservedHit.deviceName}" in parent directory ` +
        `"${reservedHit.parentPath}". `
      );
    return {
      ok: false,
      code: "invalid_filename_reserved_name",
      detail:
        reservedDetail +
        `Why this is refused: a repository containing this filename cannot ` +
        `be cloned, archived, or extracted on Windows — even when authored ` +
        `on Linux or macOS — because Windows reserves CON, PRN, AUX, NUL, ` +
        `COM0–COM9, and LPT0–LPT9 regardless of file extension or case. ` +
          `How to fix: rename to a non-reserved string ` +
        `(e.g. "${renameTarget}" → "${renameExample}").`,
      badCodepoints: [],
    };
  }

  // Cluster B Iteration 4 / usesteady-public#68 -- leading/trailing
  // whitespace refusal. Runs AFTER reserved-name (which already handles
  // "CON " by stripping trailing whitespace internally and surfacing a
  // more actionable reserved-name diagnostic) but BEFORE canonicalization
  // (whitespace-bounded names are a cheap string scan; no need to NFKC).
  //
  // Why this is refused: Windows silently strips trailing whitespace
  // (and dots) when resolving paths, so a file "config " authored on
  // Linux becomes "config" on a Windows teammate's clone and the two
  // repos disagree on which file exists. macOS and Linux preserve
  // the trailing space, so `git status` diverges across the team.
  //
  // Checked per path segment so any segment (intermediate directory
  // OR final basename) with leading/trailing whitespace is refused.
  // Empty segments (from leading/trailing slashes or `//`) are
  // skipped -- they are not whitespace-bounded, they are absent.
  const whitespaceSegment = findWhitespaceBoundarySegment(path);
  if (whitespaceSegment !== null) {
    const trimmed = whitespaceSegment.trim();
    return {
      ok: false,
      code: "invalid_filename_whitespace",
      detail:
        `Filename "${path}" contains a path segment "${whitespaceSegment}" ` +
        `with leading or trailing whitespace. Why this is refused: ` +
        `Windows silently strips trailing whitespace (and dots) when ` +
        `resolving paths, so this name resolves to "${trimmed}" on Windows ` +
        `but to the original on Linux and macOS. A repository containing ` +
        `this filename diverges across teammates' clones. How to fix: ` +
        `rename without the boundary whitespace -- "${whitespaceSegment}" ` +
        `-> "${trimmed}".`,
      badCodepoints: [],
    };
  }

  let canonical: string;
  try {
    canonical = canonicalizeForSafety(path);
  } catch (err) {
    return {
      ok: false,
      code: "canonicalization_failed",
      detail:
        `Filename "${path}" could not be canonicalized — UseSteady refused ` +
        `this safely because it could not produce a stable form for ` +
        `comparison. How to fix: try a plain ASCII filename. (Internal ` +
        `cause: ${err instanceof CanonicalizationError ? err.message : "unknown error"})`,
      badCodepoints: [],
    };
  }

  if (canonical !== path) {
    return {
      ok: false,
      code: "invalid_filename_canonical_divergence",
      detail:
        `Filename "${path}" canonicalizes to a different string (NFKC ` +
        `compatibility variants detected — e.g. fullwidth Latin, ligatures, ` +
        `superscripts). Why this is refused: two adjacent surfaces (your ` +
        `editor, the shell, the file system, Git) could disagree on whether ` +
        `"${path}" and "${canonical}" name the same file, producing ` +
        `phantom duplicates or unreachable paths. How to fix: rename to the ` +
        `canonical (ASCII-equivalent) form — "${canonical}".`,
      badCodepoints: [],
    };
  }

  return { ok: true };
}

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
export function validateReplacementTextSafety(
  text: string,
): ReplacementTextSafetyResult {
  if (typeof text !== "string") {
    return {
      ok: false,
      code: "canonicalization_failed",
      detail:
        "Replacement text input is not a string — UseSteady refused this " +
        "safely because it could not be validated. This indicates an " +
        "internal caller bug; please report it with the failing input shape.",
      badCodepoints: [],
    };
  }

  const offenders = collectOffenders(text, [
    { regex: ZERO_WIDTH_CODEPOINTS,                  label: "zero-width" },
    { regex: BIDI_CONTROL_CODEPOINTS,                label: "bidi-control" },
    { regex: REPLACEMENT_TEXT_CONTROL_CODEPOINTS,    label: "control" },
  ]);

  if (offenders.length > 0) {
    return {
      ok: false,
      code: "invalid_replacement_chars",
      detail: buildOffenderDetail(
        "Replacement text",
        offenders,
        "Replacement text containing invisible, bidirectional, or control " +
          "codepoints is refused because the written bytes would not match " +
          "what was previewed. Newlines and tabs are allowed; the offending " +
          "codepoints listed must be removed.",
      ),
      badCodepoints: offenders.map(formatCodepoint),
    };
  }

  return { ok: true };
}

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
export function classifyNormalizationDivergence(
  oldValue: string,
  content: string,
): NormalizationDivergenceCause {
  if (containsCovertCodepoint(oldValue)) return "hidden_codepoints_in_oldvalue";
  if (containsCovertCodepoint(content))  return "hidden_codepoints_in_content";

  // Try the canonical match. If oldValue canonicalizes equal to a
  // substring of canonical content, but the original oldValue is not
  // a substring of original content, the only thing that differs is
  // NFKC-equivalent codepoint shape — i.e. Unicode normalization.
  let canonOld: string;
  let canonContent: string;
  try {
    canonOld     = canonicalizeForSafety(oldValue);
    canonContent = canonicalizeForSafety(content);
  } catch {
    return "other";
  }

  const originalHas  = content.includes(oldValue);
  const canonicalHas = canonContent.includes(canonOld);

  if (!originalHas && canonicalHas) {
    return "unicode_normalization_mismatch";
  }
  // Symmetric case (original matches but canonical doesn't) is exotic
  // — would require the canonical form to lose a substring entirely.
  // Fall through to "other" so the diagnostic surface stays honest
  // about what it cannot identify.
  return "other";
}

/**
 * Build the human-facing detail message for a divergence cause
 * classified by `classifyNormalizationDivergence`. Used by
 * `inprocess-adapter.receive` to upgrade the existing
 * `ambiguous_match` detail beyond "match-count mismatch".
 */
export function describeNormalizationDivergence(
  cause: NormalizationDivergenceCause,
  oldValue: string,
  filePath: string,
): string {
  switch (cause) {
    case "unicode_normalization_mismatch":
      return (
        `Unicode normalization mismatch for "${oldValue}" in "${filePath}": ` +
        `the search string and the file content use different Unicode ` +
        `normalization forms (e.g. NFC "café" vs NFD "cafe\u0301") that ` +
        `appear identical on screen but differ at the byte level. The ` +
        `replace would match after normalization, but UseSteady refuses to ` +
        `apply it because the on-disk bytes would not match what was ` +
        `previewed. Suggested fix: re-save the file or the search string ` +
        `in a single normalization form (NFC is the conventional choice).`
      );
    case "hidden_codepoints_in_oldvalue":
      return (
        `Search string "${oldValue}" contains invisible or bidirectional ` +
        `codepoints. After stripping them the search would match the file, ` +
        `but the verbatim bytes do not appear in "${filePath}". Refusing to ` +
        `apply a replacement that would silently behave differently from ` +
        `what was previewed.`
      );
    case "hidden_codepoints_in_content":
      return (
        `File "${filePath}" contains invisible or bidirectional codepoints ` +
        `near where "${oldValue}" would otherwise match. The file's on-disk ` +
        `form and its visible form disagree; refusing to apply a targeted ` +
        `replacement because the two views diverge.`
      );
    case "other":
      return (
        `Match-count mismatch for "${oldValue}" in "${filePath}" between ` +
        `original-form and canonical-form views. One of the inputs contains ` +
        `canonicalization-sensitive characters that this version of ` +
        `UseSteady cannot classify more specifically. Refusing fail-closed.`
      );
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

type OffenderClass = "zero-width" | "bidi-control" | "control";
type Offender = { readonly codepoint: number; readonly index: number; readonly cls: OffenderClass };

/**
 * Cluster B Iteration 3.6 — named-codepoint lookup for the highest-
 * friction offenders. Embedded directly because (a) it's small, static,
 * and unlikely to change; (b) the Node stdlib does not ship Unicode
 * character names; (c) pulling in a dependency for ~20 entries violates
 * the flat pure-function discipline established in Iter 2.
 *
 * When a codepoint is in this table the error message can say
 *   `U+202E "RIGHT-TO-LEFT OVERRIDE"`
 * instead of just
 *   `U+202E`
 * which lets the user understand the refusal without leaving the
 * terminal to look up the codepoint.
 *
 * Entries are limited to codepoints that actually surface in our
 * refusal paths. Extend when a real friction reproducer names a
 * codepoint not in this table, not preemptively.
 */
const NAMED_CODEPOINTS: Readonly<Record<number, string>> = {
  // ─── BIDI overrides / embeddings (the public#50 class) ──────────────
  0x202A: "LEFT-TO-RIGHT EMBEDDING",
  0x202B: "RIGHT-TO-LEFT EMBEDDING",
  0x202C: "POP DIRECTIONAL FORMATTING",
  0x202D: "LEFT-TO-RIGHT OVERRIDE",
  0x202E: "RIGHT-TO-LEFT OVERRIDE",
  0x2066: "LEFT-TO-RIGHT ISOLATE",
  0x2067: "RIGHT-TO-LEFT ISOLATE",
  0x2068: "FIRST STRONG ISOLATE",
  0x2069: "POP DIRECTIONAL ISOLATE",
  // ─── Zero-width / invisible joiners ─────────────────────────────────
  0x200B: "ZERO WIDTH SPACE",
  0x200C: "ZERO WIDTH NON-JOINER",
  0x200D: "ZERO WIDTH JOINER",
  0x2060: "WORD JOINER",
  0xFEFF: "ZERO WIDTH NO-BREAK SPACE / BYTE ORDER MARK",
  // ─── Named ASCII / C0 controls that show up in path inputs ──────────
  0x0000: "NULL",
  0x0007: "BELL",
  0x0008: "BACKSPACE",
  0x0009: "HORIZONTAL TAB",
  0x000A: "LINE FEED",
  0x000D: "CARRIAGE RETURN",
  0x001B: "ESCAPE",
  0x007F: "DELETE",
};

function collectOffenders(
  input: string,
  rules: readonly { readonly regex: RegExp; readonly label: OffenderClass }[],
): readonly Offender[] {
  const out: Offender[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    for (const rule of rules) {
      // Each regex defined above is a single-character set without the
      // `g` flag — `.test(ch)` is stateless and safe to reuse.
      if (rule.regex.test(ch)) {
        out.push({ codepoint: ch.codePointAt(0)!, index: i, cls: rule.label });
        break;
      }
    }
  }
  return out;
}

function formatCodepoint(o: Offender): string {
  const hex = `U+${o.codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
  // Iter 3.6: include the Unicode character name when known. The bare
  // codepoint hex is a lookup task; the name is self-explanatory.
  const name = NAMED_CODEPOINTS[o.codepoint];
  const nameSegment = name !== undefined ? ` "${name}"` : "";
  return `${hex}${nameSegment} (${o.cls}, index ${o.index})`;
}

/**
 * Cluster B Iteration 3.6 — error-message format for codepoint-class
 * refusals.
 *
 * Returns a three-section message:
 *
 *   1. Lead: plain-English summary of which character class(es) the
 *      subject contained. Scannable in a single glance.
 *   2. Offender list: hex codepoints + Unicode names (when known) +
 *      sub-class + byte index. Up to 5 listed; rest summarised.
 *   3. Why + How-to-fix: the previously-existing guidance string,
 *      kept verbatim by callers so each surface can tailor the fix
 *      instruction (filename rename vs. replacement-text rewrite).
 *
 * This format keeps the test contract stable — `bidi-control`,
 * `zero-width`, `control`, and the hex codepoint all still appear in
 * the output, just in a more scannable arrangement.
 */
function buildOffenderDetail(
  subjectLabel: string,
  offenders: readonly Offender[],
  guidance: string,
): string {
  const classesSeen = new Set(offenders.map(o => o.cls));
  const classSummary = describeClasses(classesSeen);
  const count = offenders.length;
  const subj = subjectLabel.toLowerCase();
  const lead =
    `${subjectLabel} contains ${count} ${classSummary} ` +
    `codepoint${count === 1 ? "" : "s"} ` +
    `which cannot appear in a ${subj} that UseSteady will create.`;

  const listed = offenders.slice(0, 5).map(formatCodepoint).join(", ");
  const more = offenders.length > 5 ? ` (and ${offenders.length - 5} more)` : "";
  const offenderList = `Offending codepoint${count === 1 ? "" : "s"}: ${listed}${more}.`;

  return `${lead} ${offenderList} ${guidance}`;
}

/**
 * Plain-English rendering of which OffenderClass(es) appeared. The
 * canonical names (`bidi-control`, `zero-width`, `control`) are
 * preserved verbatim because tests + agent-facing logs key on them;
 * the renderings are joined with `or` for readability.
 */
function describeClasses(classes: ReadonlySet<OffenderClass>): string {
  const order: readonly OffenderClass[] = ["bidi-control", "zero-width", "control"];
  const present = order.filter(c => classes.has(c));
  if (present.length === 1) return present[0]!;
  if (present.length === 2) return `${present[0]} or ${present[1]}`;
  return `${present.slice(0, -1).join(", ")}, or ${present[present.length - 1]}`;
}

function containsCovertCodepoint(s: string): boolean {
  return (
    ZERO_WIDTH_CODEPOINTS.test(s) ||
    BIDI_CONTROL_CODEPOINTS.test(s) ||
    PATH_CONTROL_CODEPOINTS.test(s)
  );
}

/**
 * Cluster B Iteration 3.6 — suggest a non-reserved rename for the
 * offending basename. Produces a small, deterministic, copy-pasteable
 * fix that the user can paste into their next attempt.
 *
 * Rules:
 *   1. Extract the extension (if any). `con.ts` → base=`con`, ext=`.ts`.
 *      `aux` → base=`aux`, ext=``. Trailing-dot variants like `con.`
 *      drop the trailing dots before splitting.
 *   2. Append `-utils` (a plausible, non-reserved suffix that does not
 *      itself match the reserved-name set).
 *   3. Re-attach the original extension when present.
 *
 * Examples:
 *   `con`       → `con-utils`
 *   `con.ts`    → `con-utils.ts`
 *   `AUX.md`    → `AUX-utils.md` (case preserved)
 *   `COM1`      → `COM1-utils`
 *   `lpt9.log`  → `lpt9-utils.log`
 *
 * The suffix `-utils` is arbitrary but conventional in source trees;
 * the user can replace it with anything. The point is to give them a
 * concrete, working example they can edit, not the abstract instruction
 * "rename to a non-reserved string".
 */
function suggestReservedNameRename(candidate: string): string {
  const stripped = candidate.replace(/[ .]+$/u, "");
  const dotIdx = stripped.lastIndexOf(".");
  if (dotIdx > 0) {
    const base = stripped.slice(0, dotIdx);
    const ext = stripped.slice(dotIdx);
    return `${base}-utils${ext}`;
  }
  return `${stripped}-utils`;
}

/**
 * Cluster B Iteration 4 -- whitespace-bounded segment detection.
 *
 * Splits the path on both `/` and `\` (cross-platform: a `\` segment
 * in a Linux-authored path would land on a Windows clone verbatim),
 * skips empty segments (caused by leading `/`, trailing `/`, or
 * consecutive separators), and returns the first segment whose
 * leading or trailing characters are whitespace per
 * `String.prototype.trim` (covers ASCII space, tab, NBSP U+00A0, and
 * other Unicode whitespace).
 *
 * Returns `null` if every segment is whitespace-clean at its
 * boundaries. Internal whitespace ("my file.ts") is NOT refused --
 * it is legitimate developer intent and survives cross-platform.
 *
 * Determinism: pure function on a flat string. No fs, no global
 * state. Same input, same output, every host, every Node version.
 */
function findWhitespaceBoundarySegment(path: string): string | null {
  // Split on either separator. Use a regex character class rather
  // than two passes so the segment indexing is monotonic.
  const segments = path.split(/[\/\\]/);
  for (const seg of segments) {
    if (seg.length === 0) continue;  // skip empties from `/foo`, `foo/`, `foo//bar`
    if (seg.trim() !== seg) return seg;
  }
  return null;
}

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
export function validateProtectedPath(path: string): ProtectedPathResult {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: true };
  }

  // Split on either separator; ignore empties (leading/trailing/
  // doubled slash). Normalize `.` segments away too -- `./.git/HEAD`
  // and `.git/HEAD` must both refuse.
  const segments = path
    .split(/[\/\\]/)
    .filter((s) => s.length > 0 && s !== ".");

  for (const seg of segments) {
    // Case-insensitive match against the protected segment set.
    // V1 set is `.git` only (see function jsdoc rationale).
    if (seg.toLowerCase() === ".git") {
      return {
        ok: false,
        code: "prohibited_path",
        reason: "git_internals",
        detail:
          `Refusing operation on protected path "${path}". The "${seg}" ` +
          `segment is the Git repository's internal directory; touching ` +
          `files inside it (HEAD, hooks/, config, refs/, objects/) ` +
          `corrupts the repository silently and bypasses Git's own ` +
          `consistency checks. Why this is refused: this tool is not the ` +
          `right surface for repository-state edits -- it has no way to ` +
          `know which edits Git would accept and which break invariants ` +
          `the user did not see. How to fix: use \`git\` directly. For ` +
          `example, edit refs with \`git update-ref\`, manage hooks under ` +
          `\`.git/hooks/\` from a shell, and rewrite history with \`git ` +
          `rebase\` or \`git commit --amend\`. usesteady will continue to ` +
          `operate on every other path in the workspace.`,
        matchedSegment: seg,
      };
    }
  }

  return { ok: true };
}

/**
 * Windows reserved device name match (Cluster B Iteration 3 + #78).
 *
 * Returns the matched device name, candidate, and segment context for
 * the caller's error message when ANY path segment's first dot-segment
 * matches a reserved device name. Returns `null` otherwise.
 *
 * Match algorithm (case-insensitive, per segment):
 *   1. Split the path on `/` and `\`; drop empty segments.
 *   2. For each segment in order, strip trailing dots and spaces.
 *   3. Take the first dot-separated segment as the device-name candidate.
 *   4. Uppercase and look up in WINDOWS_RESERVED_DEVICE_NAMES.
 *   5. Return on the first matching segment (fail-fast).
 *
 * Edge cases deliberately handled:
 *   - Empty path or all-empty segments: returns null.
 *   - Segment that is only dots / spaces: skipped after stripping.
 *   - Mixed separators (`a/b\\CON.txt`): both `/` and `\` split.
 */
function matchWindowsReservedName(
  path: string,
): {
  readonly deviceName: string;
  readonly candidate: string;
  readonly matchedSegment: string;
  readonly isBasename: boolean;
  readonly parentPath: string;
} | null {
  if (path.length === 0) return null;

  const segments = path.split(/[\/\\]/).filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const hit = matchReservedDeviceNameInSegment(segment);
    if (hit === null) continue;

    const isBasename = i === segments.length - 1;
    return {
      deviceName: hit.deviceName,
      candidate: hit.candidate,
      matchedSegment: segment,
      isBasename,
      parentPath: segments.slice(0, i + 1).join("/"),
    };
  }

  return null;
}

/**
 * Apply Windows reserved-name candidate extraction to a single path
 * segment (no separators).
 */
function matchReservedDeviceNameInSegment(
  segment: string,
): { readonly deviceName: string; readonly candidate: string } | null {
  if (segment.length === 0) return null;

  let trimmed = segment;
  while (
    trimmed.length > 0 &&
    (trimmed.endsWith(".") || trimmed.endsWith(" "))
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.length === 0) return null;

  const firstDot = trimmed.indexOf(".");
  const candidate = firstDot >= 0 ? trimmed.slice(0, firstDot) : trimmed;
  if (candidate.length === 0) return null;

  const upper = candidate.toUpperCase();
  if (WINDOWS_RESERVED_DEVICE_NAMES.has(upper)) {
    return { deviceName: upper, candidate };
  }
  return null;
}
