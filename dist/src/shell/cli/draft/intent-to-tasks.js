/**
 * src/shell/cli/draft/intent-to-tasks.ts
 *
 * Pure intent translator — maps free-text user input to a structured list of
 * DraftTasks before the user commits to execution.
 *
 * No I/O, no external deps, no side effects.
 * Returns best-effort results: unrecognised clauses get needs_confirmation=true
 * with rawText preserved so the caller never loses the original intent.
 */
import { escapeControlForInline } from "../../render-escape.js";
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Translate a free-text intent string into a list of DraftTasks.
 *
 * Splits compound sentences on " and " boundaries (outside quotes),
 * then matches each clause against known action patterns.
 * Unparseable clauses return needs_confirmation=true with rawText preserved.
 */
const POLITE_PREFIX_RE = /^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+(?:need|want)\s+(?:you\s+)?to\s+|would\s+you\s+)/i;
function stripPolitePrefix(text) {
    return text.replace(POLITE_PREFIX_RE, "");
}
function stripWrappingQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function normalizePathToken(value) {
    const out = stripWrappingQuotes(value);
    return out.length > 0 ? out : null;
}
// ─── Quote-char normalization ────────────────────────────────────────────────
//
// Normalize Unicode "smart" / "curly" quote variants to their ASCII
// equivalents before pattern matching.
//
// Real-world sources for these characters in CLI input:
//   - macOS system-wide "Smart Quotes" substitution (on by default since
//     macOS 10.9; converts " to U+201C/U+201D as you type)
//   - iOS keyboard auto-format
//   - Copy-paste from Slack, Google Docs, Notion, most rich-text editors
//   - Microsoft Word / Outlook pastes
//   - Some terminal emulators auto-correct
//
// Pre-fix behavior: the bare-token fallback regex `[^\s"']+` matched curly
// quotes as literal characters (they're non-space and not straight quote),
// so `replace "HELLO" with "HI" in f.txt` (with curly quotes) captured
// `"HELLO"` WITH the curly quotes as the search value. The adapter then
// searched for that literal string and failed with `old_value_not_found`
// — a confusing diagnostic for a user who typed what looked like a
// straight-quoted request.
//
// Post-fix: curly quotes round-trip through this normalizer into straight
// quotes BEFORE any pattern matches, so all downstream logic (draft layer
// and canonical parser alike) sees a single canonical quoting form.
//
// Characters normalized:
//   U+201C  LEFT DOUBLE QUOTATION MARK      "
//   U+201D  RIGHT DOUBLE QUOTATION MARK     "
//   U+201E  DOUBLE LOW-9 QUOTATION MARK     "  (German / Polish / Czech)
//   U+201F  DOUBLE HIGH-REVERSED-9          "  (rare, included for completeness)
//   U+2033  DOUBLE PRIME                    "  (mistyped by some editors)
//   U+00AB  LEFT-POINTING ANGLE QUOTATION   "  (French « »)
//   U+00BB  RIGHT-POINTING ANGLE QUOTATION  "
//   U+2018  LEFT SINGLE QUOTATION MARK      '
//   U+2019  RIGHT SINGLE QUOTATION MARK     '
//   U+201A  SINGLE LOW-9 QUOTATION MARK     '
//   U+201B  SINGLE HIGH-REVERSED-9          '
//   U+2032  PRIME                           '
//
// We do NOT normalize:
//   - U+0060 GRAVE ACCENT `    (common in code; changes meaning)
//   - U+2014 EM DASH —           (structural punctuation, handled elsewhere)
//   - ASCII ' and "              (already canonical)
function normalizeQuoteChars(text) {
    return text
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, "\"")
        .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'");
}
export function translateIntent(text) {
    const normalized = stripPolitePrefix(normalizeQuoteChars(text.trim()));
    const clauses = splitClauses(normalized);
    return clauses.map(parseClause);
}
/**
 * Format a DraftTask as a human-readable one-liner for CLI display.
 * Unrecognised clauses are prefixed with "?" to signal they need review.
 *
 * alpha.56 / F-A55-1: every user-authored value embedded into this
 * line (`task.from`, `task.to`, `task.file`, `task.rawText`) is
 * routed through `escapeControlForInline` from the shared
 * `render-escape` module — the same primitive the SYSTEM WILL
 * Preview block uses. This guarantees tab/CR/newline characters
 * in user content never forge a second visual line inside the
 * pre-approval echo. The transform is identical across all
 * adjacent surfaces (intake echo, You-asked anchor, Preview
 * content), so a first-time user never sees the same content
 * rendered two different ways before approval.
 */
export function formatDraftTask(task) {
    const e = escapeControlForInline;
    if (task.needs_confirmation) {
        return `? ${e(task.rawText ?? "(unrecognized)")}`;
    }
    switch (task.action) {
        case "replace": return `Replace "${e(task.from ?? "")}" -> "${e(task.to ?? "")}" in ${e(task.file ?? "")}`;
        case "rename": return `Rename ${e(task.from ?? "")} -> ${e(task.to ?? "")}`;
        case "create": return `Create ${e(task.file ?? "")}`;
        case "delete": return `Delete ${e(task.file ?? "")}`;
        case "run_command": return `Run: ${e(task.to ?? "")}`;
        case "append": return `Append "${e(task.to ?? "")}" to ${e(task.file ?? "")}`;
        case "prepend": return `Prepend "${e(task.to ?? "")}" to ${e(task.file ?? "")}`;
    }
}
/**
 * Quote a path token for the canonical serializer when it contains a
 * whitespace character or a backslash. The downstream interpretation
 * parser (src/understand/interpretation/parser.ts) accepts either a
 * bare non-whitespace token or a double-quoted token, so the safe and
 * minimal encoding is "double-quote when the token cannot be expressed
 * as a single whitespace-free word".
 *
 * Only spaces/tabs/backslashes trigger quoting. Paths that already parse
 * as bare tokens are left untouched, preserving existing canonical output.
 */
function quotePathToken(path) {
    // Accept undefined to preserve original behavior when optional DraftTask
    // fields are missing — callers will already have validated the relevant
    // field for the concrete action type upstream.
    if (path === undefined)
        return String(path);
    if (path.length === 0)
        return path;
    if (/[\s\\]/.test(path))
        return `"${path}"`;
    return path;
}
/**
 * Convert a DraftTask to the canonical input string accepted by the existing
 * intake pipeline (cursor-product-session / coordinator).
 *
 * Parsed tasks produce the canonical replace/rename/create/delete/run format
 * that the intent parser already understands. Path tokens that contain
 * whitespace or backslashes are re-quoted so the downstream parser does
 * not truncate them at the first whitespace character.
 *
 * Unrecognised clauses pass rawText through — they will be handled as
 * skipped_by_intake if still unrecognised at runtime.
 */
export function draftTaskToInput(task) {
    if (task.needs_confirmation && task.rawText)
        return task.rawText;
    switch (task.action) {
        case "replace": return `replace "${task.from}" with "${task.to}" in ${quotePathToken(task.file)}`;
        case "rename": return `rename ${quotePathToken(task.from)} to ${quotePathToken(task.to)}`;
        case "create": return `create file ${quotePathToken(task.file)}`;
        case "delete": return `delete file ${quotePathToken(task.file)}`;
        case "run_command": return `run ${task.to}`;
        case "append": return `append "${task.to}" to ${quotePathToken(task.file)}`;
        case "prepend": return `prepend "${task.to}" to ${quotePathToken(task.file)}`;
    }
}
/**
 * Convert a raw unknown value (from JSON.parse) to a DraftTask.
 * Returns null for unknown types or missing required fields.
 * Caller must treat null as exit 2 (parse / recognition failure).
 */
export function jsonOpToDraftTask(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const op = raw;
    const from = typeof op["from"] === "string" ? op["from"] : undefined;
    const to = typeof op["to"] === "string" ? op["to"] : undefined;
    const fileRaw = typeof op["file"] === "string" ? op["file"] : undefined;
    const file = fileRaw !== undefined ? normalizePathToken(fileRaw) : undefined;
    switch (op["type"]) {
        case "rename":
            if (from === undefined || to === undefined)
                return null;
            if (from.trim().length === 0 || to.trim().length === 0)
                return null;
            return { action: "rename", from: from.trim(), to: to.trim(), rawText: `rename ${from.trim()} to ${to.trim()}` };
        case "replace":
            if (from === undefined || to === undefined || !file)
                return null;
            if (from.length === 0)
                return null;
            return { action: "replace", from, to, file, rawText: `replace "${from}" with "${to}" in ${file}` };
        case "create":
            if (!file)
                return null;
            return { action: "create", file, rawText: `create file ${file}` };
        case "delete":
            if (!file)
                return null;
            return { action: "delete", file, rawText: `delete file ${file}` };
        case "run":
            if (to === undefined || to.trim().length === 0)
                return null;
            return { action: "run_command", to: to.trim(), rawText: `run ${to.trim()}` };
        case "append":
            if (to === undefined || !file)
                return null;
            return { action: "append", to, file, rawText: `append "${to}" to ${file}` };
        case "prepend":
            if (to === undefined || !file)
                return null;
            return { action: "prepend", to, file, rawText: `prepend "${to}" to ${file}` };
        default:
            return null;
    }
}
// ─── Clause splitter ──────────────────────────────────────────────────────────
/**
 * Split compound intent text into individual clauses.
 * Splits on " and " only when not inside double quotes, using a
 * simple quote-depth heuristic (not a full parser).
 */
function splitClauses(text) {
    const parts = [];
    let current = "";
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
            i++;
            continue;
        }
        // Check for " and " boundary outside quotes
        if (!inQuotes && text.slice(i).match(/^\s+and\s+/i)) {
            const match = text.slice(i).match(/^(\s+and\s+)/i);
            parts.push(current.trim());
            current = "";
            i += match[1].length;
            continue;
        }
        current += ch;
        i++;
    }
    if (current.trim())
        parts.push(current.trim());
    return parts.filter(Boolean);
}
// ─── Pattern matchers ─────────────────────────────────────────────────────────
function parseClause(clause) {
    const raw = clause.trim();
    // replace "X" with "Y" in <file>
    //
    // Quote edge case: the NEW-value group accepts the empty string
    // (`[^"]*` instead of `[^"]+`) so `replace "HELLO" with "" in f.txt` is
    // a recognised delete-substring operation. The OLD-value group remains
    // `[^"]+` — replacing an empty string is semantically undefined (would
    // match between every character) and would produce infinite-expansion
    // bugs, so we deliberately reject it at the parser.
    const replaceCanonical = raw.match(/^replace\s+"([^"]+)"\s+with\s+"([^"]*)"\s+in\s+(.+)$/i) ??
        raw.match(/^replace\s+'([^']+)'\s+with\s+'([^']*)'\s+in\s+(.+)$/i) ??
        // PowerShell can strip inner quotes when --prompt values are expanded.
        // Accept strict single-token replacements as a deterministic fallback.
        raw.match(/^replace\s+([^\s"']+)\s+with\s+([^\s"']+)\s+in\s+(.+)$/i);
    if (replaceCanonical) {
        const file = normalizePathToken(String(replaceCanonical[3]));
        if (file) {
            return { action: "replace", from: String(replaceCanonical[1]), to: String(replaceCanonical[2]), file, rawText: raw };
        }
    }
    // change "X" to "Y" in <file>
    // Empty new-value permitted (delete operation).
    const replaceChange = raw.match(/^change\s+"([^"]+)"\s+to\s+"([^"]*)"\s+in\s+(.+)$/i) ??
        raw.match(/^change\s+'([^']+)'\s+to\s+'([^']*)'\s+in\s+(.+)$/i);
    if (replaceChange) {
        const file = normalizePathToken(String(replaceChange[3]));
        if (file) {
            return { action: "replace", from: String(replaceChange[1]), to: String(replaceChange[2]), file, rawText: raw };
        }
    }
    // update/set "X" to "Y" in <file>
    // Empty new-value permitted (delete operation).
    const replaceUpdate = raw.match(/^(?:update|set)\s+"([^"]+)"\s+to\s+"([^"]*)"\s+in\s+(.+)$/i) ??
        raw.match(/^(?:update|set)\s+'([^']+)'\s+to\s+'([^']*)'\s+in\s+(.+)$/i);
    if (replaceUpdate) {
        const file = normalizePathToken(String(replaceUpdate[3]));
        if (file) {
            return { action: "replace", from: String(replaceUpdate[1]), to: String(replaceUpdate[2]), file, rawText: raw };
        }
    }
    // rename <old> to <new>  /  mv <old> <new>  /  mv <old> to <new>
    const rename = raw.match(/^(?:rename|mv)\s+("[^"]+"|'[^']+'|\S+)\s+to\s+("[^"]+"|'[^']+'|\S+)$/i) ??
        raw.match(/^mv\s+("[^"]+"|'[^']+'|\S+)\s+("[^"]+"|'[^']+'|\S+)$/i);
    if (rename) {
        const from = normalizePathToken(String(rename[1]));
        const to = normalizePathToken(String(rename[2]));
        if (from && to) {
            return { action: "rename", from, to, rawText: raw };
        }
    }
    // create file <path>  /  touch <path>
    const createFile = raw.match(/^(?:create\s+file|touch)\s+("[^"]+"|'[^']+'|\S+)$/i);
    if (createFile) {
        const file = normalizePathToken(String(createFile[1]));
        if (file) {
            return { action: "create", file, rawText: raw };
        }
    }
    // mkdir / create folder|directory|dir <path>
    const createDir = raw.match(/^(?:mkdir|create\s+(?:folder|directory|dir))\s+("[^"]+"|'[^']+'|\S+)$/i);
    if (createDir) {
        const file = normalizePathToken(String(createDir[1]));
        if (file) {
            return { action: "create", file, rawText: raw };
        }
    }
    // delete file <path>  /  delete <path>  /  rm <path>  /  remove <path>
    const deleteFile = raw.match(/^(?:delete\s+(?:file\s+)?|rm\s+|remove\s+)("[^"]+"|'[^']+'|\S+)$/i);
    if (deleteFile) {
        const file = normalizePathToken(String(deleteFile[1]));
        if (file) {
            return { action: "delete", file, rawText: raw };
        }
    }
    // append "X" to <file>
    const append = raw.match(/^append\s+"([\s\S]*)"\s+to\s+("[^"]+"|'[^']+'|\S+)$/i) ??
        raw.match(/^append\s+'([\s\S]*)'\s+to\s+("[^"]+"|'[^']+'|\S+)$/i) ??
        raw.match(/^append\s+([^\s"']+)\s+to\s+("[^"]+"|'[^']+'|\S+)$/i);
    if (append) {
        const file = normalizePathToken(String(append[2]));
        if (file) {
            return { action: "append", to: String(append[1]), file, rawText: raw };
        }
    }
    // prepend "X" to <file>
    const prepend = raw.match(/^prepend\s+"([\s\S]*)"\s+to\s+("[^"]+"|'[^']+'|\S+)$/i) ??
        raw.match(/^prepend\s+'([\s\S]*)'\s+to\s+("[^"]+"|'[^']+'|\S+)$/i) ??
        raw.match(/^prepend\s+([^\s"']+)\s+to\s+("[^"]+"|'[^']+'|\S+)$/i);
    if (prepend) {
        const file = normalizePathToken(String(prepend[2]));
        if (file) {
            return { action: "prepend", to: String(prepend[1]), file, rawText: raw };
        }
    }
    // run <cmd>  /  npm <cmd>  /  yarn <cmd>  /  npx <cmd>  /  deno <cmd>
    const runCmd = raw.match(/^(?:run|npm|yarn|npx|deno)\s+(.+)$/i);
    if (runCmd) {
        return { action: "run_command", to: String(runCmd[1]).trim(), rawText: raw };
    }
    // Fallback — preserve original text, mark for confirmation
    return { action: "replace", needs_confirmation: true, rawText: raw };
}
//# sourceMappingURL=intent-to-tasks.js.map