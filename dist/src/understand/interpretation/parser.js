/**
 * Change command parser.
 *
 * Supported formats — text replacement:
 *   replace "X" with "Y" in <file>
 *   patch <file> search="X" replace="Y"
 *
 * Supported formats — filesystem operations:
 *   create (folder|directory) <path>
 *   create file <path>
 *   rename <path> to <newPath>
 *   (delete|remove) (file|folder|directory)? <path>
 *
 * Returns null for any other input shape.
 */
import { normalizeIntent, intentToChange } from "./intent.js";
// ─── Compound request guard ───────────────────────────────────────────────────
// Trailing content after a matched operation that signals a second operation.
// Prevents "rename X to Y and update all imports" from silently dropping
// the second half and executing only the rename.
const COMPOUND_SUFFIX_RE = /\s+(and|then|also|,\s*also|,\s*then)\s+\S/i;
function hasCompoundSuffix(input, matchEnd) {
    return COMPOUND_SUFFIX_RE.test(input.slice(matchEnd));
}
// ─── Text replacement patterns ────────────────────────────────────────────────
//
// Quote edge case: the replacement-value group accepts an empty string
// (`[^"]*` instead of `[^"]+`) so `replace "X" with "" in file` is a valid
// delete-substring operation. The search-value group remains `[^"]+` —
// replacing an empty string is semantically undefined.
const REPLACE_PATTERN = /^\s*replace\s+"([^"]+)"\s+with\s+"([^"]*)"\s+in\s+("[^"]+"|'[^']+'|\S+)/i;
const PATCH_PATTERN = /^\s*patch\s+("[^"]+"|'[^']+'|\S+)\s+search="([^"]+)"\s+replace="([^"]*)"/i;
// ─── Filesystem operation patterns ───────────────────────────────────────────
// create (folder|directory) <path>
const CREATE_DIR_PATTERN = /^\s*create\s+(?:folder|directory)\s+("[^"]+"|'[^']+'|\S+)/i;
// create file <path>
const CREATE_FILE_PATTERN = /^\s*create\s+file\s+("[^"]+"|'[^']+'|\S+)/i;
// rename <path> to <newPath>
const RENAME_PATTERN = /^\s*rename\s+("[^"]+"|'[^']+'|\S+)\s+to\s+("[^"]+"|'[^']+'|\S+)/i;
// (delete|remove) file|folder|directory <path>  — explicit keyword, any path token
const DELETE_WITH_KEYWORD_PATTERN = /^\s*(?:delete|remove)\s+(?:file|folder|directory)\s+("[^"]+"|'[^']+'|\S+)/i;
// (delete|remove) <path>  — bare path must contain a slash or extension
// Intentionally rejects bare nouns ("delete cache", "delete everything")
// to match the normalizer's looksLikePath constraint.
const DELETE_BARE_PATTERN = /^\s*(?:delete|remove)\s+((?:"[^"]+"|'[^']+'|\S+))/i;
function stripWrappingQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
// ─── Parser ───────────────────────────────────────────────────────────────────
// Defense-in-depth curly-quote normalization.
// The draft layer (src/shell/cli/draft/intent-to-tasks.ts) normalizes these
// before draft dispatch, but parseChange() is also called directly from the
// workflow engine (coordinator re-parses task.input when there's no structured
// operationType) so we must normalize here as well. Idempotent on
// already-straight input.
function normalizeQuoteChars(text) {
    return text
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, "\"")
        .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'");
}
export function parseChange(rawInput) {
    const input = normalizeQuoteChars(rawInput);
    // ── 0. Compound request guard ─────────────────────────────────────────────
    // Reject inputs that describe more than one operation so the system never
    // silently executes only the first half (e.g. "rename X to Y and update
    // all imports" must not silently drop "and update all imports").
    if (COMPOUND_SUFFIX_RE.test(input))
        return null;
    // ── 1. Deterministic NL normalization (handles natural-language variants) ──
    // This runs before strict patterns so "create a test folder" and
    // "make a folder called components" are recognized without silent skip.
    const intent = normalizeIntent(input.trim());
    if (intent !== null)
        return intentToChange(intent);
    // ── 2. Strict patterns (canonical exact-match formats) ────────────────────
    // Text replacement (existing)
    const replaceMatch = REPLACE_PATTERN.exec(input);
    if (replaceMatch !== null) {
        if (hasCompoundSuffix(input, replaceMatch[0].length))
            return null;
        const fp = replaceMatch[3];
        const filePath = stripWrappingQuotes(fp ?? "");
        if (filePath.length === 0)
            return null;
        return {
            oldValue: replaceMatch[1],
            newValue: replaceMatch[2],
            filePath,
        };
    }
    const patchMatch = PATCH_PATTERN.exec(input);
    if (patchMatch !== null) {
        if (hasCompoundSuffix(input, patchMatch[0].length))
            return null;
        const fp = patchMatch[1];
        const filePath = stripWrappingQuotes(fp ?? "");
        if (filePath.length === 0)
            return null;
        return {
            oldValue: patchMatch[2],
            newValue: patchMatch[3],
            filePath,
        };
    }
    // Filesystem operations (new)
    const createDirMatch = CREATE_DIR_PATTERN.exec(input);
    if (createDirMatch !== null) {
        if (hasCompoundSuffix(input, createDirMatch[0].length))
            return null;
        const dirPath = stripWrappingQuotes(createDirMatch[1]);
        if (dirPath.length === 0)
            return null;
        return { operationType: "create_dir", dirPath };
    }
    const createFileMatch = CREATE_FILE_PATTERN.exec(input);
    if (createFileMatch !== null) {
        if (hasCompoundSuffix(input, createFileMatch[0].length))
            return null;
        const filePath = stripWrappingQuotes(createFileMatch[1]);
        if (filePath.length === 0)
            return null;
        return { operationType: "write_file", filePath, content: "" };
    }
    const renameMatch = RENAME_PATTERN.exec(input);
    if (renameMatch !== null) {
        if (hasCompoundSuffix(input, renameMatch[0].length))
            return null;
        const filePath = stripWrappingQuotes(renameMatch[1]);
        const newPath = stripWrappingQuotes(renameMatch[2]);
        if (filePath.length === 0 || newPath.length === 0)
            return null;
        return { operationType: "rename", filePath, newPath };
    }
    const deleteKwMatch = DELETE_WITH_KEYWORD_PATTERN.exec(input);
    if (deleteKwMatch !== null) {
        if (hasCompoundSuffix(input, deleteKwMatch[0].length))
            return null;
        const filePath = stripWrappingQuotes(deleteKwMatch[1]);
        if (filePath.length === 0)
            return null;
        return { operationType: "delete_file", filePath };
    }
    const deleteBareMatch = DELETE_BARE_PATTERN.exec(input);
    if (deleteBareMatch !== null) {
        if (hasCompoundSuffix(input, deleteBareMatch[0].length))
            return null;
        const filePath = stripWrappingQuotes(deleteBareMatch[1]);
        if (filePath.length === 0)
            return null;
        if (!filePath.includes("/") && !filePath.includes("\\") && !/\.[^\\/]+$/.test(filePath)) {
            return null;
        }
        return { operationType: "delete_file", filePath };
    }
    return null;
}
/** Extract the filename from a path without importing node:path. */
export function basename(filePath) {
    return filePath.split(/[/\\]/).pop() ?? filePath;
}
//# sourceMappingURL=parser.js.map