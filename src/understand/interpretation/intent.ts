/**
 * Deterministic intent normalizer — P0 natural-language normalization.
 *
 * Combines broad natural-language verb coverage (create, mkdir, scaffold,
 * spin up…) with a looksLikePath() safety gate that blocks ambiguous or
 * nonsense captures before they reach the execution pipeline.
 *
 * Design decisions locked:
 *   – No AI / model calls
 *   – Class 1: leading polite-prefix stripping (please, can you, could you,
 *     i need, i want to) — only the leading softener is removed, never
 *     mid-sentence words
 *   – Class 2: article/noise tolerance for rename ("the file X") and delete
 *     ("the X folder") — surgical patterns, not general NL parsing
 *   – Class 3 intentional gap: "make a folder for X" stays null — "for X"
 *     is ambiguous (purpose vs. name) and belongs in a clarification card
 *   – looksLikePath() gate: all NL-captured names must look like real paths
 *   – extractPathFromTail() is intentionally absent from NL matchers;
 *     only explicit CLI commands (mkdir, touch, mv, rm) are unguarded
 *   – Reversed patterns ("create X folder") use looksLikePath; multi-word
 *     captures like "some structure to the" are automatically rejected
 *   – Broad delete matching restricted to tokens with extension or separator
 *     (bare nouns require an explicit type keyword)
 *   – If normalisation fails, caller falls through to strict parser
 *   – No change to authority model or execution scope
 */

import type { ParsedChange, FsChange, ReplaceChange } from "./types.js";

// ─── ParsedIntent ─────────────────────────────────────────────────────────────

export type ParsedIntent =
  | { readonly kind: "create_dir";  readonly path: string }
  | { readonly kind: "create_file"; readonly path: string; readonly content?: string }
  | { readonly kind: "rename";      readonly from: string; readonly to: string }
  | { readonly kind: "delete";      readonly path: string }
  | { readonly kind: "replace";     readonly find: string; readonly replace: string; readonly file: string };

// ─── Path safety gate ─────────────────────────────────────────────────────────

/**
 * Returns true only when a captured string plausibly looks like a filesystem
 * path.  This is the core guard that prevents ambiguous NL prose (e.g.
 * "some structure to the") from being accepted as a directory name.
 *
 * Accepts:
 *   clean identifier     "test", "components", "MyApp", "my-app"
 *   path with slashes    "src/utils", "lib/auth/index"
 *   name with extension  "README.md", "App.tsx", "config.json"
 *   dotfile              ".gitignore", ".env"
 *
 * Rejects:
 *   empty string, strings with spaces, strings that are pure prose
 */
function looksLikePath(s: string): boolean {
  if (!s || s.length === 0) return false;
  if (s.includes(" ")) return false;
  if (/\.[a-zA-Z0-9]{1,10}$/.test(s)) return true;       // has extension
  if (s.includes("/") || s.includes("\\")) return true;   // path separator
  if (/^[a-zA-Z0-9_\-.]+$/.test(s)) return true;         // clean identifier
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collapse internal whitespace and trim. */
function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Class 1 — Strip a single leading polite softener.
 *
 * Only the leading prefix is removed, never words mid-sentence.
 * Supported prefixes: please, can you, could you, i need [to], i want to.
 *
 * Examples:
 *   "please create folder utils"       → "create folder utils"
 *   "can you create a folder called utils" → "create a folder called utils"
 *   "i need a folder called auth"      → "a folder called auth"
 *   "i want to rename old.ts to new.ts" → "rename old.ts to new.ts"
 *   "i need to delete src/old.ts"      → "delete src/old.ts"
 */
const POLITE_PREFIX =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+need\s+(?:to\s+)?|i\s+want\s+to\s+)/i;

function stripLeadingPrefix(s: string): string {
  return s.replace(POLITE_PREFIX, "").trimStart();
}

/**
 * Extract the content of the first quoted segment (double, single, backtick).
 * Allows quoted paths that contain spaces.
 */
function extractQuoted(input: string): string | null {
  const dq = /"([^"]+)"/.exec(input);
  if (dq?.[1]) return dq[1].trim();
  const sq = /'([^']+)'/.exec(input);
  if (sq?.[1]) return sq[1].trim();
  const bq = /`([^`]+)`/.exec(input);
  if (bq?.[1]) return bq[1].trim();
  return null;
}

/**
 * Clean a raw capture-group value and apply looksLikePath.
 *
 * Order:
 *  1. Try quoted extraction (allows space-containing paths)
 *  2. Strip NL filler prefixes (called/named/as)
 *  3. Apply looksLikePath gate — rejects multi-word prose, pure nouns, etc.
 */
function cleanPath(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Quoted paths bypass the looksLikePath check (user explicitly delimited them)
  const quoted = extractQuoted(trimmed);
  if (quoted && quoted.length > 0) return quoted;

  // Strip common filler prefixes before validating
  const stripped = trimmed
    .replace(/^(?:called|named|as)\s+/i, "")
    .replace(/[.?!]+$/, "")
    .trim();

  if (!stripped) return null;
  return looksLikePath(stripped) ? stripped : null;
}

// ─── matchCreateDir ───────────────────────────────────────────────────────────

// Forward: verb + [a] + dir-keyword + [called/named] + name
// Covers: "create folder test", "initialize directory src/utils", "scaffold folder components"
const CREATE_DIR_FORWARD: readonly RegExp[] = [
  /^(?:create|make|add|new|init|initialize|scaffold|generate|setup)\s+(?:a\s+)?(?:folder|directory|dir)\s+(?:(?:called|named)\s+)?(?<p>.+)$/i,
  // "a new" adjective form — "called/named" is REQUIRED after the keyword to prevent
  // "initialize a new folder structure" from matching with path="structure"
  /^(?:create|make|add|init|initialize|scaffold|generate|setup)\s+a\s+new\s+(?:folder|directory|dir)\s+(?:called|named)\s+(?<p>.+)$/i,
  // "set up" and "spin up" contain a space — listed separately to avoid regex complexity
  /^(?:set\s+up|spin\s+up)\s+(?:a\s+)?(?:folder|directory|dir)\s+(?:(?:called|named)\s+)?(?<p>.+)$/i,
  // No-verb form — produced by polite-prefix stripping ("i need a folder called auth"
  // → "a folder called auth").  "called/named" is REQUIRED; there is no action verb
  // to act as an anchor so we need the strongest possible discriminator.
  /^a[n]?\s+(?:new\s+)?(?:folder|directory|dir)\s+(?:called|named)\s+(?<p>.+)$/i,
];

// Reversed: verb + [a] + name + dir-keyword
// Covers: "create a test folder", "make a components folder", "add utils directory"
// Only the most natural-sounding verbs — not "scaffold a foo folder"
const CREATE_DIR_REVERSED: readonly RegExp[] = [
  /^(?:create|make|add)\s+(?:a\s+)?(?<p>.+?)\s+(?:folder|directory|dir)$/i,
];

function matchCreateDir(raw: string): ParsedIntent | null {
  // 1. CLI-native: mkdir <path>  (unguarded — user intentionally typed CLI syntax)
  const mkdirM = /^mkdir\s+(?<p>.+)$/i.exec(raw);
  if (mkdirM?.groups?.p) {
    const p = mkdirM.groups.p.trim();
    return p ? { kind: "create_dir", path: p } : null;
  }

  // 2. Forward: verb + keyword + name  (cleanPath applies looksLikePath gate)
  for (const pat of CREATE_DIR_FORWARD) {
    const m = pat.exec(raw);
    if (m?.groups?.p) {
      const path = cleanPath(m.groups.p);
      if (path) return { kind: "create_dir", path };
    }
  }

  // 3. Reversed: verb + name + keyword
  //    Multi-word captures like "some structure to the" fail looksLikePath ✓
  for (const pat of CREATE_DIR_REVERSED) {
    const m = pat.exec(raw);
    if (m?.groups?.p) {
      const path = cleanPath(m.groups.p);
      if (path) return { kind: "create_dir", path };
    }
  }

  return null;
}

// ─── matchCreateFile ──────────────────────────────────────────────────────────

// [a] + [new/empty/blank] adjective slot — "create a new file", "make an empty file called x"
const CREATE_FILE_FORWARD: readonly RegExp[] = [
  /^(?:create|make|add|new|write)\s+(?:a[n]?\s+)?(?:new|empty|blank)?\s*file\s+(?:(?:called|named)\s+)?(?<p>.+)$/i,
  // No-verb form — produced by polite-prefix stripping ("i need a file called X")
  // "called/named" is REQUIRED as the discriminating anchor.
  /^a[n]?\s+(?:new|empty|blank)?\s*file\s+(?:called|named)\s+(?<p>.+)$/i,
];

const CREATE_FILE_REVERSED: readonly RegExp[] = [
  /^(?:create|make|add)\s+(?:a\s+)?(?<p>.+?)\s+file$/i,
];

function matchCreateFile(raw: string): ParsedIntent | null {
  // 1. CLI-native: touch <path>  (unguarded)
  const touchM = /^touch\s+(?<p>.+)$/i.exec(raw);
  if (touchM?.groups?.p) {
    const p = touchM.groups.p.trim();
    return p ? { kind: "create_file", path: p } : null;
  }

  // 2. Forward: verb + "file" + name
  for (const pat of CREATE_FILE_FORWARD) {
    const m = pat.exec(raw);
    if (m?.groups?.p) {
      const path = cleanPath(m.groups.p);
      if (path) return { kind: "create_file", path };
    }
  }

  // 3. Reversed: verb + name + "file"
  //    "create a README.md file"  — looksLikePath gate blocks prose captures
  for (const pat of CREATE_FILE_REVERSED) {
    const m = pat.exec(raw);
    if (m?.groups?.p) {
      const path = cleanPath(m.groups.p);
      if (path) return { kind: "create_file", path };
    }
  }

  return null;
}

// ─── matchRename ──────────────────────────────────────────────────────────────

function matchRename(raw: string): ParsedIntent | null {
  // 1. CLI-native: mv <from> <to>  (unguarded — expects exactly two tokens)
  const mvM = /^mv\s+(\S+)\s+(\S+)$/i.exec(raw);
  if (mvM?.[1] && mvM?.[2]) {
    return { kind: "rename", from: mvM[1], to: mvM[2] };
  }

  // 1b. Quoted paths — rename "from path" to "to path"
  //     Allows space-containing filenames: rename "my file.ts" to "your file.ts"
  //     Double-quote form:
  const dqM = /^(?:rename|move)\s+"([^"]+)"\s+to\s+"([^"]+)"$/i.exec(raw);
  if (dqM?.[1] && dqM?.[2]) {
    return { kind: "rename", from: dqM[1].trim(), to: dqM[2].trim() };
  }
  //     Single-quote form:
  const sqM = /^(?:rename|move)\s+'([^']+)'\s+to\s+'([^']+)'$/i.exec(raw);
  if (sqM?.[1] && sqM?.[2]) {
    return { kind: "rename", from: sqM[1].trim(), to: sqM[2].trim() };
  }

  // 2. rename/move <path> to <path>
  //    Class 2: optional "the file|folder|directory" article noise before the source path
  //    "rename the file old.ts to new.ts" → from="old.ts", to="new.ts"
  const m = /^(?:rename|move)\s+(?:the\s+(?:file|folder|directory)\s+)?(\S+(?:\/\S+)*)\s+to\s+(\S+(?:\/\S+)*)$/i.exec(raw);
  if (m?.[1] && m?.[2]) {
    return { kind: "rename", from: m[1], to: m[2] };
  }

  return null;
}

// ─── matchDelete ──────────────────────────────────────────────────────────────

function matchDelete(raw: string): ParsedIntent | null {
  // 1. CLI-native: rm <path>  (unguarded)
  const rmM = /^rm\s+(?<p>.+)$/i.exec(raw);
  if (rmM?.groups?.p) {
    const p = rmM.groups.p.trim();
    return p ? { kind: "delete", path: p } : null;
  }

  // 2. Class 2: "delete the X folder" / "remove the X file"
  //    Article noise before a single-token path and an explicit type keyword.
  //    Single-token constraint (`\S+`) prevents multi-word captures; looksLikePath
  //    rejects bare prose nouns.  "delete the old stuff folder" fails because
  //    `\S+` only captures "old" and then `\s+folder$` can't match " stuff folder".
  const articleM = /^(?:delete|remove)\s+the\s+(\S+)\s+(?:file|folder|directory|dir)$/i.exec(raw);
  if (articleM?.[1]) {
    const path = cleanPath(articleM[1]);
    if (path) return { kind: "delete", path };
  }

  // 3. Explicit keyword: delete/remove [the] file|folder|directory <name>
  //    "delete file src/unused.ts"  "remove folder temp"  "remove directory build"
  //    "remove the file temp.txt"  "delete the folder build"  (Class 2 — keyword-first)
  //    cleanPath gate: "delete folder the old stuff" → looksLikePath fails ✓
  const kwM = /^(?:delete|remove)\s+(?:the\s+)?(?:file|folder|directory|dir)\s+(?<p>.+)$/i.exec(raw);
  if (kwM?.groups?.p) {
    const path = cleanPath(kwM.groups.p);
    if (path) return { kind: "delete", path };
  }

  // 4. Bare path: delete/remove <single-token-path>
  //    Restricted to tokens with an extension OR path separator.
  //    This intentionally rejects bare identifiers like "delete cache" or
  //    "delete everything" — single nouns are too ambiguous without a keyword.
  const bareM = /^(?:delete|remove)\s+(\S+)$/i.exec(raw);
  if (bareM?.[1]) {
    const candidate = bareM[1];
    const hasExt = /\.[a-zA-Z0-9]{1,10}$/.test(candidate);
    const hasSep = candidate.includes("/") || candidate.includes("\\");
    if (hasExt || hasSep) {
      return { kind: "delete", path: candidate };
    }
  }

  return null;
}

// ─── matchReplace ─────────────────────────────────────────────────────────────

function matchReplace(raw: string): ParsedIntent | null {
  // replace "X" with "Y" in file  (double quotes)
  const rdq = /^replace\s+"([^"]+)"\s+with\s+"([^"]+)"\s+in\s+(\S+(?:\/\S+)*)$/i.exec(raw);
  if (rdq?.[1] && rdq?.[2] && rdq?.[3]) {
    return { kind: "replace", find: rdq[1], replace: rdq[2], file: rdq[3] };
  }

  // replace 'X' with 'Y' in file  (single quotes)
  const rsq = /^replace\s+'([^']+)'\s+with\s+'([^']+)'\s+in\s+(\S+(?:\/\S+)*)$/i.exec(raw);
  if (rsq?.[1] && rsq?.[2] && rsq?.[3]) {
    return { kind: "replace", find: rsq[1], replace: rsq[2], file: rsq[3] };
  }

  // change "X" to "Y" in file  (double quotes, natural phrasing)
  const cdq = /^change\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+(\S+(?:\/\S+)*)$/i.exec(raw);
  if (cdq?.[1] && cdq?.[2] && cdq?.[3]) {
    return { kind: "replace", find: cdq[1], replace: cdq[2], file: cdq[3] };
  }

  // change 'X' to 'Y' in file  (single quotes)
  const csq = /^change\s+'([^']+)'\s+to\s+'([^']+)'\s+in\s+(\S+(?:\/\S+)*)$/i.exec(raw);
  if (csq?.[1] && csq?.[2] && csq?.[3]) {
    return { kind: "replace", find: csq[1], replace: csq[2], file: csq[3] };
  }

  // Unquoted single-token forms — "change foo to bar in App.tsx"
  //   and "replace foo with bar in App.tsx"
  //
  // Safety constraints (both must hold):
  //   1. find and replace are single non-space tokens (\S+) — multi-word values
  //      fail to match, e.g. "change old button text to new one in App.tsx" → null
  //   2. file must have a recognised extension OR a path separator — bare words
  //      like "production" or "config" are rejected to prevent over-matching prose.
  //      This is intentionally stricter than looksLikePath's clean-identifier check.
  const unquotedChange = /^change\s+(\S+)\s+to\s+(\S+)\s+in\s+(\S+)$/i.exec(raw);
  if (unquotedChange?.[1] && unquotedChange?.[2] && unquotedChange?.[3]) {
    const file = unquotedChange[3];
    const hasExt = /\.[a-zA-Z0-9]{1,10}$/.test(file);
    const hasSep = file.includes("/") || file.includes("\\");
    if (hasExt || hasSep) {
      return { kind: "replace", find: unquotedChange[1], replace: unquotedChange[2], file };
    }
  }

  const unquotedReplace = /^replace\s+(\S+)\s+with\s+(\S+)\s+in\s+(\S+)$/i.exec(raw);
  if (unquotedReplace?.[1] && unquotedReplace?.[2] && unquotedReplace?.[3]) {
    const file = unquotedReplace[3];
    const hasExt = /\.[a-zA-Z0-9]{1,10}$/.test(file);
    const hasSep = file.includes("/") || file.includes("\\");
    if (hasExt || hasSep) {
      return { kind: "replace", find: unquotedReplace[1], replace: unquotedReplace[2], file };
    }
  }

  return null;
}

// ─── normalizeIntent ──────────────────────────────────────────────────────────

/**
 * Convert a free-form user string into a structured ParsedIntent.
 *
 * Returns null when:
 *   - The input is empty or whitespace
 *   - The input is ambiguous or vague (no recognised operation + valid path)
 *   - A required field (path, from/to, etc.) cannot be determined safely
 *
 * On null the caller falls through to the strict canonical parser.
 */
export function normalizeIntent(raw: string): ParsedIntent | null {
  const collapsed = collapseSpaces(raw);
  if (!collapsed) return null;

  // Class 1: strip a single leading polite softener before matching.
  // Only the social wrapper is removed; mid-sentence words are untouched.
  const input = collapseSpaces(stripLeadingPrefix(collapsed));
  if (!input) return null;

  // replace/change must be tested first — the verb "replace" is also a
  // file-like create verb in some patterns; checking it first avoids ambiguity.
  return (
    matchReplace(input)    ??
    matchCreateDir(input)  ??
    matchCreateFile(input) ??
    matchRename(input)     ??
    matchDelete(input)     ??
    null
  );
}

// ─── intentToChange ───────────────────────────────────────────────────────────

/**
 * Convert a ParsedIntent into the canonical ParsedChange used by the execution
 * pipeline (FsChange | ReplaceChange).
 *
 * This is the only bridge between the normalizer and the execution path.
 * No new execution paths are introduced here.
 */
export function intentToChange(intent: ParsedIntent): ParsedChange {
  switch (intent.kind) {
    case "create_dir":
      return {
        operationType: "create_dir",
        dirPath: intent.path,
      } satisfies FsChange;

    case "create_file":
      return {
        operationType: "write_file",
        filePath: intent.path,
        content: intent.content ?? "",
      } satisfies FsChange;

    case "rename":
      return {
        operationType: "rename",
        filePath: intent.from,
        newPath: intent.to,
      } satisfies FsChange;

    case "delete":
      return {
        operationType: "delete_file",
        filePath: intent.path,
      } satisfies FsChange;

    case "replace":
      return {
        oldValue: intent.find,
        newValue: intent.replace,
        filePath: intent.file,
      } satisfies ReplaceChange;
  }
}

// ─── describeIntent ───────────────────────────────────────────────────────────

/**
 * Human-readable "SYSTEM WILL:" description for a ParsedIntent.
 * Used in the UI approval frame to surface normalised intent to the user.
 */
export function describeIntent(intent: ParsedIntent): string {
  switch (intent.kind) {
    case "create_dir":  return `Create directory: ./${intent.path}`;
    case "create_file": return `Create file: ./${intent.path}`;
    case "rename":      return `Rename path: ${intent.from}  →  ${intent.to}`;
    case "delete":      return `Delete path: ./${intent.path}`;
    case "replace":     return `Replace text in: ${intent.file}`;
  }
}
