/**
 * src/input/nl-to-ir.ts
 *
 * M4 — Natural-language InputNormalizer.
 *
 * Deterministic, dependency-free function from a free-text NL input to IR
 * (or a structured normalize-stage `CliError`). This is the *new* normalizer
 * for the `--prompt` / bare-positional / stdin-pipe hot path.
 *
 * Per design §3.1 + §6.6 (`docs/CLI_INPUT_NORMALIZATION_DESIGN.md` v2.3) this
 * module is a new file, NOT an edit of either legacy parser. The legacy
 * strict parser (`src/understand/interpretation/parser.ts`) and draft parser
 * (`src/shell/cli/draft/intent-to-tasks.ts`) stay in the tree as spare wheels
 * until M6 retires them. This mirrors the M2 pattern: `json-to-ir.ts` was
 * introduced alongside an untouched `jsonOpToDraftTask`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M4 contract (load-bearing — see design §6.6.1)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. Deterministic only. No LLM. No heuristic guess. If NL cannot be committed
 *    to a precise IR op, a `NormalizeError` is returned — never an IR with
 *    hidden ambiguity. (§5.2 lossless guarantee, §6.6.1 rule 6.)
 *
 * 2. One canonical place for smart-quote folding and polite-prefix stripping.
 *    Legacy duplicates in `parser.ts` and `intent-to-tasks.ts` are not edited
 *    by M4 — they remain until M6. (§5.3, §6.6.1 rule 3.)
 *
 * 3. File-vs-directory vocabulary is a deterministic dispatch, not an
 *    inference. `mkdir` / `folder` / `directory` / `dir` → `create_dir`;
 *    `touch` / `file` / bare `create <path>` → `create`. (§6.6.1 rule 2.)
 *
 * 4. Compound NL is rejected, not parsed. `... and ...`, `... then ...`,
 *    `... also ...`, `..., then ...`, `..., also ...` → `parse_error`.
 *    Multi-op NL is not a milestone — it remains a JSON/batch concept.
 *    (§6.6.1 rule 5.)
 *
 * 5. `stage: "normalize"` is populated for the first time. The `NormalizeError`
 *    shape was forward-declared in M3 (`src/input/cli-error.ts`). No new
 *    public errorCode constants are introduced in M4 — every normalize-stage
 *    error uses a code already in the public enum. (§6.6.1 rule 4 + rule 7.)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Ambiguity table (§6.6.1 rule 2, locked at the M4 gate)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   | Class                                        | Behavior                                |
 *   |---                                           |---                                      |
 *   | `replace` without explicit occurrence        | normalize error (`ambiguous_match`)     |
 *   | Smart quotes (U+201C/U+201D/U+2018/U+2019)   | deterministic fold to ASCII (in here)   |
 *   | Bare verbs / missing targets                 | normalize error (`parse_error`)         |
 *   | Polite prefixes                              | deterministic strip (in here)           |
 *   | File vs directory vocabulary                 | deterministic dispatch (see above)      |
 *
 * The `replace` rule is the strictest reading of §5.2's "replace it (no count)
 * → structured error, does not silently default" combined with §6.6.1 rule 2's
 * "no silent default". Because the normalizer cannot read file contents, the
 * presence or absence of an explicit occurrence clause is the only signal it
 * has; it uses that signal as the entire gate. This IS one of the five
 * deliberate public-surface refinements (R4) and is noted in the M4 release
 * notes per §6.6.2's requirement.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  What this file does NOT do
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   - It does not open files (M3 validator owns path-level feasibility; M4
 *     defers to it).
 *   - It does not call the legacy draft or strict parsers (§6.6.1 rule 1).
 *   - It does not wire the Cursor REPL (§6.6.3 — that surface is M5's mandate).
 *   - It does not re-evaluate argv or stdin (the caller, use-steady.ts, owns
 *     input collection; this module only consumes the already-collected text).
 *   - It does not introduce new errorCode constants (§6.6.1 rule 7 ≈ M3
 *     §6.5.1 rule 6 extended upstream).
 */
import { canonicalizeNearMiss } from "./near-miss-canonicalizer.js";
/**
 * Normalize a free-text NL input string to IR.
 *
 * Pipeline (deterministic; each step is pure and independent of downstream
 * state):
 *
 *   1. Reject empty / whitespace-only input.
 *   2. Smart-quote fold (one canonical place — §5.3).
 *   3. Polite-prefix strip (one canonical place — §5.3).
 *   4. Compound-NL rejection (§6.6.1 rule 5).
 *   5. Verb dispatch — file vs directory is a deterministic dispatch.
 *
 * The `source.raw` field preserves the caller-supplied `input` verbatim, so
 * diagnostics and friction reports quote exactly what the user typed, not
 * what the normalizer reconstructed (§5.3 last bullet).
 */
export function normalizeNLToIR(input, surface) {
    const raw = input;
    const irSurface = toIRSourceSurface(surface);
    // Step 1 — empty input. A stage-1 failure; no downstream work needed.
    const trimmed = input.replace(/^\s+|\s+$/g, "");
    if (trimmed.length === 0) {
        return normalizeErr("parse_error", "empty input: natural-language request is required", irSurface, raw);
    }
    // Step 2 — smart-quote fold. Deterministic, one canonical place (§5.3).
    // Matches the character set already covered by the legacy draft parser's
    // `normalizeQuoteChars`, so byte-for-byte accept/reject parity is
    // preserved for the documented NL shapes. Intentionally excludes U+0060
    // (grave) — legacy explicitly preserves it (see intent-to-tasks.ts:94).
    const folded = foldSmartQuotes(trimmed);
    // Step 3 — polite-prefix strip. One canonical place (§5.3). Same regex
    // the legacy draft parser uses, anchored at string start, single pass.
    const impolite = stripPolitePrefix(folded);
    // Step 4 — compound NL rejection (§6.6.1 rule 5). Anywhere outside quotes
    // the conjunction pattern appears, reject. Multi-op NL is not an M4
    // feature; users are directed to `batch` or `--json`.
    if (containsCompoundConjunction(impolite)) {
        return normalizeErr("parse_error", "compound NL not supported — use batch or --json for multi-op inputs", irSurface, raw);
    }
    // Step 4.5 — near-miss canonicalization (USESTEADY_NEAR_MISS_SYNTHESIS_V1).
    // Deterministically rewrite high-confidence create-folder/create-file
    // near-misses ("make a folder for components", "add a file for tests") into
    // the canonical verb forms `dispatchToOp` already accepts, so they reach a
    // deterministic SYSTEM WILL instead of the SYSTEM SUGGESTS recovery surface.
    // This is a no-op for every other input — vague stays Reflection, ambiguous
    // create / delete / rename stay SUGGESTS, and existing canonical forms map to
    // themselves. `source.raw` (set above) still preserves the user's verbatim
    // phrasing for display/diagnostics; only the dispatch text is canonicalized.
    const dispatchText = canonicalizeNearMiss(impolite);
    // Step 5 — verb dispatch. First match wins; order is deliberate so that
    // `mkdir X` hits the `create_dir` branch before the generic `create X`
    // fallback, and so `change "X" to "Y" in F` / `update ... to ... in F` /
    // `set ... to ... in F` are routed to replace like the legacy draft
    // parser accepts.
    const dispatched = dispatchToOp(dispatchText);
    if (dispatched.kind === "error") {
        return normalizeErr(dispatched.code, dispatched.message, irSurface, raw);
    }
    const ir = {
        operations: [dispatched.op],
        source: { surface: irSurface, raw },
    };
    return { kind: "ok", ir };
}
/**
 * Detect whether the raw CLI argv contains `--prompt` (or `-p`) more than
 * once. Used by the argv pre-parser in `use-steady.ts` to close R3 (duplicate
 * `--prompt`) at the input-collection boundary before any normalization runs.
 *
 * Per §6.6.2 R3: reuses the existing `conflicting_input_sources` public
 * errorCode (already emitted at `use-steady.ts:513` for cross-source
 * conflicts). The M4 normalizer does not invent `duplicate_prompt`.
 *
 * Exported here (not inlined at the call site) so a single place defines the
 * flag-name list and so the unit test can lock the behavior.
 */
export function detectDuplicatePromptFlag(rawArgs) {
    let count = 0;
    for (const arg of rawArgs) {
        if (arg === "--prompt" || arg === "-p") {
            count += 1;
            if (count > 1)
                return true;
        }
    }
    return false;
}
// ─── Surface mapping ─────────────────────────────────────────────────────────
function toIRSourceSurface(surface) {
    // See the NLSurface JSDoc above for the rationale on mapping "stdin"
    // to "prompt" rather than widening IRSourceSurface.
    switch (surface) {
        case "prompt":
        case "stdin":
            return "prompt";
        case "positional":
            return "positional";
    }
}
function normalizeErr(code, message, surface, raw) {
    return {
        kind: "error",
        error: {
            stage: "normalize",
            code,
            message,
            surface,
            raw,
        },
    };
}
// ─── Step 2: smart-quote fold ────────────────────────────────────────────────
// Character sets mirror the legacy draft parser (`normalizeQuoteChars` at
// `src/shell/cli/draft/intent-to-tasks.ts:97`). U+0060 (grave) is
// deliberately preserved — changing it would alter code semantics.
const SMART_DOUBLE_QUOTES_RE = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;
const SMART_SINGLE_QUOTES_RE = /[\u2018\u2019\u201A\u201B\u2032]/g;
function foldSmartQuotes(text) {
    return text
        .replace(SMART_DOUBLE_QUOTES_RE, "\"")
        .replace(SMART_SINGLE_QUOTES_RE, "'");
}
// ─── Step 3: polite-prefix strip ─────────────────────────────────────────────
// Identical pattern to the legacy draft parser's `POLITE_PREFIX_RE`
// (`src/shell/cli/draft/intent-to-tasks.ts:32`). §5.3 requires the regex be
// owned in *one* place on the hot path; M4 owns it here, legacy still has
// its copy as a spare wheel.
const POLITE_PREFIX_RE = /^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+(?:need|want)\s+(?:you\s+)?to\s+|would\s+you\s+)/i;
function stripPolitePrefix(text) {
    return text.replace(POLITE_PREFIX_RE, "");
}
// ─── Step 4: compound-NL detection ───────────────────────────────────────────
/**
 * Return true iff the text contains a compound-NL conjunction outside of
 * quoted spans. The conjunction set (` and `, ` then `, ` also `, `, also`,
 * `, then`) matches §6.6.1 rule 5 verbatim.
 *
 * Scans the string with a quote-depth heuristic (identical to the legacy
 * draft parser's `splitClauses`) so `rename "a and b" to "c"` is NOT treated
 * as compound. The scan is intentionally minimal — it is not a full parser,
 * just enough to distinguish "conjunction inside a quoted filename" from
 * "conjunction joining two clauses".
 */
function containsCompoundConjunction(text) {
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\"" && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (inDouble || inSingle)
            continue;
        // ` and ` / ` then ` / ` also `
        if (ch === " " || ch === "\t") {
            const rest = text.slice(i);
            if (/^\s+(?:and|then|also)\s+/i.test(rest) &&
                // Ensure there is clause-shaped content on both sides.
                // Boundary check: at i > 0 there IS content on the left by virtue
                // of being past the first char; right side is enforced by `\s+X\s+`
                // requiring content after the keyword.
                i > 0) {
                return true;
            }
        }
        // `, also` / `, then`
        if (ch === ",") {
            const rest = text.slice(i);
            if (/^,\s*(?:also|then)\s+/i.test(rest)) {
                return true;
            }
        }
    }
    return false;
}
function dispatchToOp(text) {
    // Order matters:
    //   1. replace family (canonical, change, update, set) — content with
    //      explicit occurrence clause required.
    //   2. rename / mv.
    //   3. create_dir vocabulary (mkdir, create folder|directory|dir) BEFORE
    //      create-file so `mkdir foo` is dispatched correctly (§6.6.1 rule 2
    //      / R2).
    //   4. create file / touch.
    //   5. delete / rm / remove.
    //   6. append.
    //   7. prepend.
    //   8. run.
    //
    // Bare verbs fall through to a structured parse_error (§6.6.1 rule 2
    // "bare verbs / missing targets").
    const asReplace = matchReplace(text);
    if (asReplace !== null)
        return asReplace;
    const asRename = matchRename(text);
    if (asRename !== null)
        return asRename;
    const asCreateDir = matchCreateDir(text);
    if (asCreateDir !== null)
        return asCreateDir;
    const asCreate = matchCreate(text);
    if (asCreate !== null)
        return asCreate;
    const asDelete = matchDelete(text);
    if (asDelete !== null)
        return asDelete;
    const asAppend = matchAppend(text);
    if (asAppend !== null)
        return asAppend;
    const asPrepend = matchPrepend(text);
    if (asPrepend !== null)
        return asPrepend;
    const asRun = matchRun(text);
    if (asRun !== null)
        return asRun;
    const asFix = matchFix(text);
    if (asFix !== null)
        return asFix;
    // Bare-verb detection — a leading verb alone with no object (§6.6.1 rule 2:
    // "bare verbs / missing targets → parse_error"). The message names the
    // verb explicitly so the user gets a precise diagnostic rather than the
    // legacy "I couldn't translate that into structured steps." tip fallback.
    const bareVerb = text.match(/^(replace|change|update|set|rename|mv|mkdir|touch|create|delete|rm|remove|append|prepend|run)\s*$/i);
    if (bareVerb) {
        return {
            kind: "error",
            code: "parse_error",
            message: `bare verb "${bareVerb[1]}" with no target — provide the full NL request ` +
                "(e.g. 'rename A to B', 'create file path', 'delete file path')",
        };
    }
    return {
        kind: "error",
        code: "parse_error",
        message: "input did not match any supported NL shape. " +
            "Supported: replace \"X\" with \"Y\" in <file> <first|all|Nth occurrence>, " +
            "append \"X\" to <file>, prepend \"X\" to <file>, rename <old> to <new>, " +
            "create file <path>, mkdir <path>, delete file <path>, run <command>",
    };
}
// ─── Per-op matchers ─────────────────────────────────────────────────────────
// Quoted-or-bare file-path/value token.
//   "..." / '...' — the inner text (may contain spaces)
//   \S+          — a bare whitespace-free token
// Consumer code calls `unquotePathToken` to strip wrapping quotes.
const PATH_TOKEN_RE = /"[^"]+"|'[^']+'|\S+/.source;
function unquotePathToken(raw) {
    const t = raw.trim();
    if ((t.startsWith("\"") && t.endsWith("\"")) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1).trim();
    }
    return t;
}
// ── replace ─────────────────────────────────────────────────────────────────
/**
 * Match any of the five `replace`-family verbs used by the legacy parser.
 * Each variant requires `"X"` / `'X'` quoted content for the from/to values
 * (matching legacy's accept set). `from` must be non-empty; `to` may be
 * empty (empty-new-value is a valid delete-substring per the legacy `replace
 * "X" with "" in F` test case).
 *
 * R4 — occurrence clause is required. Without one, the normalizer emits
 * `ambiguous_match` (§5.2 + §6.6.1 rule 2, §6.6.2 R4). See the module JSDoc
 * "Ambiguity table" for the rationale.
 */
function matchReplace(text) {
    // `replace "X" with "Y" in <file>` — canonical.
    //   - Double-quoted X and Y; file is a path token (quoted or bare).
    //   - `from` non-empty (`[^"]+`); `to` allowed empty (`[^"]*`).
    // `change "X" to "Y" in <file>` — alias.
    // `update/set "X" to "Y" in <file>` — aliases.
    // Each alias is a separate regex kept aligned with the legacy draft parser
    // (see `src/shell/cli/draft/intent-to-tasks.ts:284-320`).
    //
    // An optional occurrence clause can appear after the file token:
    //   `... in <file> [,] <occurrence-clause>`
    const occurrenceTail = `(?:\\s*[,]?\\s*(.+?))?`;
    const patterns = [
        new RegExp(`^replace\\s+"([^"]+)"\\s+with\\s+"([^"]*)"\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        new RegExp(`^replace\\s+'([^']+)'\\s+with\\s+'([^']*)'\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        new RegExp(`^change\\s+"([^"]+)"\\s+to\\s+"([^"]*)"\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        new RegExp(`^change\\s+'([^']+)'\\s+to\\s+'([^']*)'\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        new RegExp(`^(?:update|set)\\s+"([^"]+)"\\s+to\\s+"([^"]*)"\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        new RegExp(`^(?:update|set)\\s+'([^']+)'\\s+to\\s+'([^']*)'\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        // USESTEADY_PRIMITIVE_PARITY_V1 — unquoted single-token grammar coverage.
        // `from`/`to` are single whitespace/quote-free tokens (multi-word values
        // still require quotes). These run AFTER the quoted patterns so quoted input
        // is never reinterpreted. They share the SAME occurrence gate below, so R4
        // is preserved: bare (no occurrence clause) still returns ambiguous_match.
        new RegExp(`^replace\\s+([^\\s"'\`]+)\\s+with\\s+([^\\s"'\`]+)\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
        new RegExp(`^(?:change|update|set)\\s+([^\\s"'\`]+)\\s+to\\s+([^\\s"'\`]+)\\s+in\\s+(${PATH_TOKEN_RE})${occurrenceTail}\\s*$`, "i"),
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (!m)
            continue;
        const from = String(m[1]);
        const to = String(m[2]);
        const fileRaw = String(m[3]);
        const occurrenceRaw = m[4] !== undefined ? String(m[4]).trim() : "";
        const file = unquotePathToken(fileRaw);
        if (file.length === 0) {
            return {
                kind: "error",
                code: "parse_error",
                message: "replace target file is empty after unquoting",
            };
        }
        if (from.length === 0) {
            // Matches legacy behavior: empty-from is rejected at the parser level
            // (`[^"]+` vs `[^"]*`). Returning parse_error here mirrors the legacy
            // "needs_confirmation" escape that M4 chooses to tighten into a
            // structured error — same family, cleaner surface.
            return {
                kind: "error",
                code: "parse_error",
                message: "replace \"from\" value is empty — replacing an empty string is undefined",
            };
        }
        const occurrence = parseOccurrenceClause(occurrenceRaw);
        if (occurrence === null) {
            // R4 — no explicit occurrence clause. Normalize-stage ambiguous_match.
            return {
                kind: "error",
                code: "ambiguous_match",
                message: "replace requires an explicit occurrence clause — " +
                    "add \"first occurrence\", \"all occurrences\", or \"<Nth> occurrence\" " +
                    "(e.g. 'replace \"X\" with \"Y\" in file.ts first occurrence')",
            };
        }
        return {
            kind: "ok",
            op: {
                type: "replace",
                // usesteady-public#45 — NL surface always carries an explicit
                // occurrence clause (R4 fires above if absent), so the user-
                // requested directive is the same value the parser committed to.
                // Writing it into both `occurrence` (system-chosen, required by
                // §5.1) and `requestedOccurrence` (user's explicit directive,
                // optional) lets downstream layers distinguish NL-explicit from
                // JSON-defaulted on the same shape. See ir.ts JSDoc on
                // `requestedOccurrence` for the contract.
                args: { file, from, to, occurrence, requestedOccurrence: occurrence },
            },
        };
    }
    return null;
}
/**
 * Parse an occurrence clause string into a `ReplaceOccurrence`, or return
 * `null` if the clause is empty or does not match a supported form.
 *
 * Accepted forms (case-insensitive, after an optional leading `the `):
 *   - `first` / `1st` / `first occurrence` / `first instance`
 *   - `all` / `every` / `all occurrences` / `every occurrence`
 *   - `<N>(st|nd|rd|th)` / `<N>(st|nd|rd|th) occurrence` / `<N>(st|nd|rd|th) instance`
 *   - `second` / `third` / `fourth` / `fifth` / `sixth` / `seventh` /
 *     `eighth` / `ninth` / `tenth` (and each with optional `occurrence` /
 *     `instance` suffix)
 *
 * Returns `null` for empty (R4 trigger) or malformed input. A malformed
 * clause is intentionally NOT a separate parse_error — from the user's
 * perspective "replace X with Y in F fifteenthth occurrence" is an
 * unrecognizable occurrence clause, so falling through to `null` surfaces
 * the same ambiguous_match diagnostic as "no clause at all". That avoids
 * introducing a second error path for the same root cause.
 */
function parseOccurrenceClause(clause) {
    if (clause.length === 0)
        return null;
    // Normalize whitespace; strip optional leading "the ".
    const s = clause.replace(/^the\s+/i, "").trim().toLowerCase();
    if (/^(?:first|1st)(?:\s+(?:occurrence|instance))?$/.test(s)) {
        return "first";
    }
    if (/^(?:all|every)(?:\s+(?:occurrences?|instances?))?$/.test(s)) {
        return "all";
    }
    // Digit ordinals — 2nd, 3rd, 4th, etc.
    const digitOrd = s.match(/^(\d+)(?:st|nd|rd|th)(?:\s+(?:occurrence|instance))?$/);
    if (digitOrd) {
        const n = Number.parseInt(digitOrd[1], 10);
        if (Number.isFinite(n) && n >= 1) {
            return { index: n };
        }
    }
    // Word ordinals — second..tenth. Kept explicit (not a generic parser) so
    // the accept set is visible and tight.
    const wordOrdinals = {
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
        eighth: 8,
        ninth: 9,
        tenth: 10,
    };
    const wordOrd = s.match(/^(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:\s+(?:occurrence|instance))?$/);
    if (wordOrd) {
        const n = wordOrdinals[wordOrd[1]];
        return { index: n };
    }
    return null;
}
// ── rename / mv ─────────────────────────────────────────────────────────────
function matchRename(text) {
    // `rename A to B` / `mv A to B` / `move A to B`.
    //
    // USESTEADY_PRIMITIVE_PARITY_V1: `move` is a deterministic synonym for
    // `rename`/`mv` (the IR has a single `rename` op for path-to-path moves). An
    // optional leading type-noun (`file`/`folder`/`directory`/`dir`) is accepted
    // and discarded as noise so `move file a to b` parses identically to
    // `move a to b`. The type-noun is only consumed when followed by another
    // path token (it never swallows the actual source path).
    const typeNoun = `(?:(?:file|folder|directory|dir)\\s+)?`;
    const withTo = text.match(new RegExp(`^(?:rename|mv|move)\\s+${typeNoun}(${PATH_TOKEN_RE})\\s+to\\s+(${PATH_TOKEN_RE})\\s*$`, "i"));
    // `mv A B` (no `to`) — legacy accepts this.
    const withoutTo = !withTo
        ? text.match(new RegExp(`^mv\\s+(${PATH_TOKEN_RE})\\s+(${PATH_TOKEN_RE})\\s*$`, "i"))
        : null;
    const m = withTo ?? withoutTo;
    if (!m)
        return null;
    const from = unquotePathToken(String(m[1]));
    const to = unquotePathToken(String(m[2]));
    if (from.length === 0 || to.length === 0) {
        return {
            kind: "error",
            code: "parse_error",
            message: "rename from/to path is empty after unquoting",
        };
    }
    return { kind: "ok", op: { type: "rename", args: { from, to } } };
}
// ── create_dir (mkdir / create folder|directory|dir) ────────────────────────
function matchCreateDir(text) {
    // `mkdir PATH` / `create folder PATH` / `create directory PATH` /
    // `create dir PATH`. Dispatch is deterministic — this runs BEFORE the
    // generic `create file PATH` matcher so `mkdir foo` does not fall through
    // to a file op (§6.6.1 rule 2 / R2).
    const m = text.match(new RegExp(`^(?:mkdir|create\\s+(?:folder|directory|dir))\\s+(${PATH_TOKEN_RE})\\s*$`, "i"));
    if (!m)
        return null;
    const path = unquotePathToken(String(m[1]));
    if (path.length === 0) {
        return {
            kind: "error",
            code: "parse_error",
            message: "create_dir path is empty after unquoting",
        };
    }
    return { kind: "ok", op: { type: "create_dir", args: { path } } };
}
// ── create file / touch ─────────────────────────────────────────────────────
function matchCreate(text) {
    // `create file PATH` / `touch PATH` — file creation. Must run AFTER
    // `matchCreateDir` so `create folder X` does not reach this matcher.
    const m = text.match(new RegExp(`^(?:create\\s+file|touch)\\s+(${PATH_TOKEN_RE})\\s*$`, "i"));
    if (!m)
        return null;
    const path = unquotePathToken(String(m[1]));
    if (path.length === 0) {
        return {
            kind: "error",
            code: "parse_error",
            message: "create path is empty after unquoting",
        };
    }
    return { kind: "ok", op: { type: "create", args: { path } } };
}
// ── delete / rm / remove ────────────────────────────────────────────────────
/**
 * Vague delete-target lexicon (Cluster B Iteration 3.5 — safety gate).
 *
 * Strings in this set are recognised at parse time as *targets without a
 * concrete referent*. They are NOT filenames — they are the names AI agents
 * (and users in a hurry) reach for when they want broad destruction without
 * having committed to which files are in scope. Per AGENTS.md UI-W1, a
 * non-deterministic input must route through `skipped_by_intake` / "COULD
 * NOT UNDERSTAND", NOT through `ApprovalFrame` with a fabricated
 * `delete_file("everything")` op.
 *
 * Scope is deliberately bounded to delete (per the Iteration 3.5 ADR /
 * task brief). Vague *create* targets like "create a folder for
 * components" already hit `parse_error` elsewhere; vague *replace*
 * targets are gated by R4's explicit-occurrence rule. This list adds
 * only the delete sub-gap.
 *
 * Match is exact (after lowercase + trim + whitespace collapse). A real
 * filename like `things.ts`, `all-tests.md`, or `everything-bagel.txt`
 * is NOT in the set and is unaffected. The set is intentionally small —
 * AGENTS.md "no abstractions without a concrete current user flow"
 * applies. Extend when a real friction reproducer surfaces a missing
 * phrase, not preemptively.
 */
const VAGUE_DELETE_TARGETS = new Set([
    // Single-token universals
    "everything",
    "all",
    "stuff",
    "things",
    "files",
    "everything.",
    // Quoted multi-word phrases (the only way these reach matchDelete is
    // wrapped in quotes — bare `delete the whole project` already fails the
    // single-PATH_TOKEN regex and short-circuits to `parse_error` upstream).
    "the whole project",
    "the project",
    "the repo",
    "the repository",
    "the codebase",
    "all files",
    "all of it",
    "all the files",
    "all the things",
]);
function isVagueDeleteTarget(path) {
    const normalized = path.trim().toLowerCase().replace(/\s+/g, " ");
    return VAGUE_DELETE_TARGETS.has(normalized);
}
function matchDelete(text) {
    // `delete file PATH` / `delete folder PATH` / `delete PATH` / `rm PATH` /
    // `remove PATH` / `remove the file PATH`.
    //
    // USESTEADY_PRIMITIVE_PARITY_V1: accept an optional type-noun
    // (`file`/`folder`/`directory`/`dir`) and an optional article that is ONLY
    // valid when bundled with that type-noun. This is what lets `delete folder
    // temp` and `remove the file temp.txt` parse, while a bare article phrase like
    // `remove the code` does NOT (the article is not consumed without a type-noun,
    // so the residual `the code` fails the single-path-token match and falls to
    // parse_error -> Reflection). The IR has one `delete` op for files and
    // directories, so the type-noun is discarded as noise after dispatch.
    const articleNoun = `(?:(?:the|a|an|this|that|my|our|your)\\s+)?(?:file|folder|directory|dir)\\s+`;
    const m = text.match(new RegExp(`^(?:delete|rm|remove)\\s+(?:${articleNoun})?(${PATH_TOKEN_RE})\\s*$`, "i"));
    if (!m)
        return null;
    const path = unquotePathToken(String(m[1]));
    if (path.length === 0) {
        return {
            kind: "error",
            code: "parse_error",
            message: "delete path is empty after unquoting",
        };
    }
    // Cluster B Iteration 3.5 — vague-target safety gate.
    //
    // The parser refuses to commit to a concrete `delete_file` op when the
    // target token is one the lexicon recognises as universally vague
    // (`everything`, `all`, `the whole project`, etc.). Returning
    // `parse_error` here propagates through `synthesizeStructuredFieldsFromNL`
    // as `{ ok: false }`; the WorkflowSpec task stays raw NL, and the
    // coordinator's restored UI-W1 routing sends it to `skipped_by_intake` →
    // COULD NOT UNDERSTAND. Same end-state as any other input the parser
    // cannot pin down deterministically.
    //
    // The error message names the offending token explicitly so the COULD
    // NOT UNDERSTAND OutcomeRow can echo it back verbatim and the Skills v1
    // adapter can decide whether to surface a recovery suggestion (the
    // existing `VAGUE_NAMES` guard in `local-recovery-adapter.ts` already
    // suppresses SYSTEM SUGGESTS for this class).
    if (isVagueDeleteTarget(path)) {
        // Iter 3.6: explain *why* vagueness is refused (broad targets can't
        // be approved without naming the files in scope), then give two
        // concrete remediation paths the user can pick from.
        return {
            kind: "error",
            code: "parse_error",
            message: `delete target "${path}" is too vague — UseSteady cannot approve a ` +
                `deletion without knowing which exact files are in scope, and ` +
                `"${path}" matches no single file or directory. To proceed, name ` +
                `the exact file or directory (e.g. "delete file src/old.ts", "rm ` +
                `temp/"). To delete multiple items, list each one as a separate ` +
                `task — each gets its own approval gate.`,
        };
    }
    return { kind: "ok", op: { type: "delete", args: { path } } };
}
// ── append / prepend ────────────────────────────────────────────────────────
function matchAppend(text) {
    return matchAppendOrPrepend(text, "append");
}
function matchPrepend(text) {
    return matchAppendOrPrepend(text, "prepend");
}
function matchAppendOrPrepend(text, verb) {
    // Three accept forms (aligned with legacy `intent-to-tasks.ts:361-382`):
    //   `<verb> "X" to <file>`
    //   `<verb> 'X' to <file>`
    //   `<verb> bare-token to <file>`  (bare-token = `[^\s"']+`)
    // Text permits empty string (`[\s\S]*`) matching the legacy capture.
    const patterns = [
        new RegExp(`^${verb}\\s+"([\\s\\S]*)"\\s+to\\s+(${PATH_TOKEN_RE})\\s*$`, "i"),
        new RegExp(`^${verb}\\s+'([\\s\\S]*)'\\s+to\\s+(${PATH_TOKEN_RE})\\s*$`, "i"),
        new RegExp(`^${verb}\\s+([^\\s"']+)\\s+to\\s+(${PATH_TOKEN_RE})\\s*$`, "i"),
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (!m)
            continue;
        const textArg = String(m[1]);
        const file = unquotePathToken(String(m[2]));
        if (file.length === 0) {
            return {
                kind: "error",
                code: "parse_error",
                message: `${verb} target file is empty after unquoting`,
            };
        }
        return {
            kind: "ok",
            op: { type: verb, args: { file, text: textArg } },
        };
    }
    return null;
}
// ── vague operational targets (USESTEADY_WILL_SYNTHESIS_TRUTHFULNESS_V1) ─────
/**
 * Demonstrative / generic operational targets that carry no concrete referent.
 *
 * `matchRun` and `matchFix` turn an NL imperative into a `run` op whose
 * "command" is the NL text itself. That is only honest when the target names a
 * concrete subject ("fix the login crash", "run the test suite", "run npm
 * test"). When the target is a bare demonstrative ("this file", "it") or a
 * universal ("all", "everything"), the resulting `run` op is a fabricated
 * SYSTEM WILL — the system promises to run something it cannot actually name.
 * Such inputs must fall through to `parse_error` -> Reflection.
 *
 * Match is exact after lowercase + trailing-punctuation strip + whitespace
 * collapse, so concrete targets ("the login crash", "searchAdminUsers",
 * "npm test") are unaffected.
 */
const VAGUE_OPERATIONAL_TARGETS = new Set([
    "this", "this file", "this code", "this one", "this thing", "this stuff",
    "that", "it", "them", "this bug", "the bug",
    "all", "everything", "stuff", "things", "anything", "something",
    "the file", "the files", "the code", "the codebase",
    "the project", "the repo", "the repository",
]);
function isVagueOperationalTarget(target) {
    const normalized = target
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return VAGUE_OPERATIONAL_TARGETS.has(normalized);
}
// ── command-shape gate (USESTEADY_RUN_COMMAND_TRUTHFULNESS_V1) ───────────────
/**
 * Executable tools whose presence as the FIRST token of a `run` target makes
 * the target a plausible shell command. This is deliberately an allowlist of
 * common dev binaries, not an open heuristic: `matchRun` promises the system
 * WILL run the command, so anything that is not recognizably a command must
 * fall to Reflection rather than fabricate an executable SYSTEM WILL.
 *
 * Observation (live sessions): `run` was turning NL prose, ticket labels, and
 * multi-clause instructions ("run full e2e", "run R3", "run the full audit +
 * propose sequence", "run deep QA") into a fabricated `run_command` WILL. None
 * of the real leaks were clean shell commands, so gating on a known first
 * token closes them with no legitimate-command loss.
 */
const KNOWN_RUN_TOOLS = new Set([
    "npm", "pnpm", "yarn", "npx", "bun", "bunx", "deno",
    "node", "tsx", "ts-node", "nodemon",
    "python", "python3", "py", "pip", "pip3", "pipx", "pytest", "tox", "uv",
    "ruby", "rake", "bundle", "gem",
    "cargo", "rustc", "rustup",
    "go", "gofmt",
    "make", "cmake", "ninja", "gradle", "gradlew", "mvn", "ant",
    "dotnet", "java", "javac", "kotlin",
    "php", "composer", "artisan", "rails", "bundler",
    "docker", "docker-compose", "podman", "kubectl", "helm", "terraform",
    "ansible", "vagrant",
    "git", "gh", "hg", "svn",
    "bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd",
    "curl", "wget", "http",
    "eslint", "prettier", "biome", "tsc", "vitest", "jest", "mocha",
    "playwright", "cypress", "vite", "webpack", "rollup", "esbuild", "turbo",
    "next", "nuxt", "nest", "ng", "expo", "remix", "astro",
    "psql", "mysql", "sqlite3", "mongo", "mongosh", "redis-cli",
    "aws", "gcloud", "az", "vercel", "netlify", "fly", "flyctl",
    "ls", "cat", "echo", "grep", "rg", "find", "sed", "awk", "cp", "mv",
    "rm", "mkdir", "touch", "chmod", "tar", "zip", "unzip",
]);
/**
 * A `run` target is command-shaped when:
 *   - it has no NL question marker (`?`), AND
 *   - its first token is either an executable-path form (`./x`, `../x`, `/abs`,
 *     or a token containing a path separator like `scripts/test.sh`), OR a
 *     recognized tool from {@link KNOWN_RUN_TOOLS}.
 *
 * Everything else (NL prose, bare nouns, ticket labels like `R3`/`ED-5A`,
 * multi-clause instructions) is not a command and must route to Reflection.
 */
function isCommandShaped(command) {
    const trimmed = command.trim();
    if (trimmed.length === 0)
        return false;
    // A question mark is an NL signal, never part of a clean command we synthesize.
    if (trimmed.includes("?"))
        return false;
    const firstToken = trimmed.split(/\s+/)[0] ?? "";
    // Executable-path form: ./run.sh, ../x, /usr/bin/x, scripts/test.sh, .\x.ps1
    if (/^\.{0,2}[\\/]/.test(firstToken) || firstToken.includes("/"))
        return true;
    return KNOWN_RUN_TOOLS.has(firstToken.toLowerCase());
}
// ── run ─────────────────────────────────────────────────────────────────────
function matchRun(text) {
    // `run <command...>` — the rest of the line is the command, preserved as a
    // single string. Promoting to `args[]` is deferred per §6.6.4.
    const m = text.match(/^run\s+(.+?)\s*$/i);
    if (!m)
        return null;
    const command = String(m[1]).trim();
    if (command.length === 0) {
        return {
            kind: "error",
            code: "parse_error",
            message: "run command is empty",
        };
    }
    // Truthfulness gate (WILL synthesis): a bare demonstrative / universal target
    // ("run it", "run all") cannot become a concrete run op. Fall to Reflection.
    if (isVagueOperationalTarget(command)) {
        return {
            kind: "error",
            code: "parse_error",
            message: `run target "${command}" is too vague — name the concrete command to run ` +
                `(e.g. "run npm test", "run npx vitest")`,
        };
    }
    // Truthfulness gate (USESTEADY_RUN_COMMAND_TRUTHFULNESS_V1): `run` promises the
    // system WILL execute the command. If the target is not command-shaped (NL
    // prose, a bare noun, a ticket label like "R3", a multi-clause instruction),
    // synthesizing a `run` op fabricates an executable SYSTEM WILL. Fall through to
    // Reflection instead. Clean commands ("run npm test", "run ./build.sh") pass.
    if (!isCommandShaped(command)) {
        return {
            kind: "error",
            code: "parse_error",
            message: `run target "${command}" is not a recognizable command — start with the ` +
                `tool to invoke (e.g. "run npm test", "run npx vitest", "run ./build.sh")`,
        };
    }
    return { kind: "ok", op: { type: "run", args: { command } } };
}
// ── fix ──────────────────────────────────────────────────────────────────────
/**
 * D2 — Operator fix-class imperatives ("Fix X").
 *
 * Structural detection: "Fix" followed by a concrete noun phrase (target).
 * Both "Fix X" and "Run X" are operator imperatives on an existing artifact;
 * they share the same IR routing path (source: "ir"). The fix target is
 * preserved as the run command so downstream surfaces can display it.
 *
 * "Fix the login crash." → run "fix the login crash"
 *
 * USESTEADY_BUSINESS_INTENT_CORPUS_V2 D2: q5-op-1 corpus anchor.
 */
function matchFix(text) {
    const m = text.match(/^fix\s+(.+?)[.!?]?\s*$/i);
    if (!m)
        return null;
    const target = String(m[1]).trim();
    if (target.length === 0) {
        return {
            kind: "error",
            code: "parse_error",
            message: "fix target is empty",
        };
    }
    // Truthfulness gate (WILL synthesis): a bare demonstrative / universal target
    // ("fix this file", "fix all") names no concrete subject, so synthesizing a
    // `run "fix ..."` op would fabricate a SYSTEM WILL. Fall to Reflection.
    // Concrete subjects ("fix the login crash") are unaffected.
    if (isVagueOperationalTarget(target)) {
        return {
            kind: "error",
            code: "parse_error",
            message: `fix target "${target}" is too vague — name the concrete thing to fix ` +
                `(e.g. "fix the login crash") or describe the exact change`,
        };
    }
    return { kind: "ok", op: { type: "run", args: { command: `fix ${target}` } } };
}
//# sourceMappingURL=nl-to-ir.js.map