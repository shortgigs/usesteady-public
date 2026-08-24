/**
 * src/shell/cli/normalize-prompt-text.ts
 *
 * Stabilization P0 — PR-4 (input hardening)
 * -----------------------------------------------------------------------------
 * CLI-entry quote sanitizer for the `--prompt` value. Runs BEFORE any
 * NL normalizer or grammar parser sees the input.
 *
 * Scope (locked, see docs/STABILIZATION_P0.md §4 Phase 3):
 *   1. Shell-level escape unfolding: `\"` → `"` and `\'` → `'`. Shells
 *      sometimes deliver literal backslash-escape sequences (especially
 *      Windows PowerShell double-quoted argvs); strip one level of escape
 *      so downstream sees the user's intended text.
 *
 *   2. Matched outer wrapper strip: if the entire value is wrapped by a
 *      matched outer quote pair (the user typed `--prompt "replace X..."`
 *      AND the shell preserved the outer quotes in argv), peel that one
 *      pair off. Unmatched or mismatched ends are left intact.
 *
 * PR-4 fixes (D2):
 *
 *   Fix A — length guard.
 *     Before: a single-character input `"` passed both startsWith and
 *     endsWith on the SAME character, and `slice(1, -1)` returned the
 *     empty string. A literal single quote-char prompt was silently
 *     corrupted to empty input. Now guarded at `length >= 2`.
 *
 *   Fix B — matched outer smart-quote wrapper strip.
 *     When users paste from macOS Notes / Slack / Docs / Word / iOS, the
 *     outer wrapper is commonly `\u201Chello\u201D` (or `\u2018hello\u2019`)
 *     — smart quote pairs that the ASCII-only check did not recognize.
 *     The prompt value then slipped through this layer with smart quotes
 *     still attached; the NL normalizer's `foldSmartQuotes` converts
 *     mid-content smart quotes to ASCII but does NOT strip outer
 *     wrappers. Downstream grammar then saw `"hello"` as the whole
 *     statement and behaved inconsistently. We now strip a matched outer
 *     smart-quote pair here — ONLY the two common directional pairs that
 *     are semantically matched openers/closers.
 *
 * Canonical-place discipline (D3): this is a matched-outer-pair strip,
 * not a fold. Mid-content smart-quote folding remains the sole
 * responsibility of `foldSmartQuotes` in `src/input/nl-to-ir.ts`. This
 * layer never rewrites characters inside the prompt body.
 *
 * Non-goals:
 *   - No grammar change. No verb/preposition change.
 *   - No fold of ANY mid-content characters (that's nl-to-ir's job).
 *   - No handling of guillemets / low-9 quotes / prime marks as outer
 *     wrappers — those aren't idiomatic prompt wrappers in practice,
 *     and adding them here would overlap with future nl-to-ir fold
 *     coverage decisions. Out of scope for PR-4.
 */
/**
 * Matched outer smart-quote pairs. Only directional opener/closer pairs
 * that are semantically matched are stripable as outer wrappers.
 *
 *   \u201C LEFT  DOUBLE QUOTATION MARK  →  \u201D RIGHT DOUBLE QUOTATION MARK
 *   \u2018 LEFT  SINGLE QUOTATION MARK  →  \u2019 RIGHT SINGLE QUOTATION MARK
 */
const OUTER_SMART_PAIRS = [
    ["\u201C", "\u201D"],
    ["\u2018", "\u2019"],
];
export function hasMatchedOuterAsciiPair(s) {
    if (s.length < 2)
        return false;
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    return (first === "\"" && last === "\"") || (first === "'" && last === "'");
}
export function hasMatchedOuterSmartPair(s) {
    if (s.length < 2)
        return false;
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    for (const [open, close] of OUTER_SMART_PAIRS) {
        if (first === open && last === close)
            return true;
    }
    return false;
}
/**
 * Sanitize a raw `--prompt` value from argv.
 *
 * Order of operations:
 *   1. Unescape shell-level `\"` → `"` and `\'` → `'` (one level).
 *   2. If the result is length >= 2 AND wrapped in a matched outer
 *      pair (ASCII `"..."` / `'...'`, or smart `\u201C...\u201D` /
 *      `\u2018...\u2019`), strip exactly that outer pair.
 *
 * Pure function — safe to call anywhere. No I/O, no globals.
 */
export function normalizePromptText(value) {
    const out = value.replace(/\\"/g, "\"").replace(/\\'/g, "'");
    if (hasMatchedOuterAsciiPair(out) || hasMatchedOuterSmartPair(out)) {
        return out.slice(1, -1);
    }
    return out;
}
//# sourceMappingURL=normalize-prompt-text.js.map