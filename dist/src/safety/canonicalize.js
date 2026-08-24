/**
 * Input canonicalization for safety detectors.
 *
 * Pure deterministic transform applied to input strings *before* any safety
 * detector executes. Detectors themselves are not modified — they continue
 * to operate on the canonical form they receive.
 *
 * Transform (in this fixed order):
 *   1. NFKC normalization                — folds compatibility variants
 *      (fullwidth Latin, compatibility ligatures, superscripts, etc.) into
 *      their canonical ASCII-equivalent codepoints so that detector patterns
 *      written against ASCII still match.
 *   2. Zero-width character stripping    — removes ZWSP, ZWNJ, ZWJ, BOM,
 *      WORD JOINER. These can be injected between letters of a forbidden
 *      term to defeat substring matching.
 *   3. Bidirectional override stripping  — removes the BIDI override and
 *      isolate codepoints (LRE/RLE/PDF/LRO/RLO/LRI/RLI/FSI/PDI) and the
 *      direction marks (LRM/RLM). These reorder the *displayed* glyphs
 *      without changing the codepoint sequence; stripping them ensures
 *      the detector reads the same sequence the source author actually
 *      typed.
 *
 * Fail-closed contract:
 *   canonicalizeForSafety throws CanonicalizationError on any malformed
 *   input it cannot canonicalize. Callers (safety gate, control compiler)
 *   are required to treat a thrown CanonicalizationError as a blocking
 *   outcome — never as a soft warning, never as a silent allow.
 *
 * Determinism:
 *   For every string s, canonicalizeForSafety(s) returns the same output on
 *   every call, on every host, in every Node version that supports Unicode
 *   normalization (>= 10). The function is referentially transparent.
 *
 * Scope:
 *   This module canonicalizes strings flowing into existing safety
 *   detectors. It does not change detector logic, detector results,
 *   approval semantics, or any envelope schema. Original (raw) inputs
 *   are preserved by callers for audit purposes; only the *detector view*
 *   is canonicalized.
 */
// ─── Stripping sets ──────────────────────────────────────────────────────────
/**
 * Zero-width / invisible-glue codepoints commonly used to break substring
 * matching. Each codepoint contributes no visible glyph but separates
 * adjacent characters in any naive `.includes(...)` scan.
 *
 *   U+200B  ZERO WIDTH SPACE
 *   U+200C  ZERO WIDTH NON-JOINER
 *   U+200D  ZERO WIDTH JOINER
 *   U+2060  WORD JOINER
 *   U+FEFF  ZERO WIDTH NO-BREAK SPACE (BOM)
 */
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
/**
 * Bidirectional control / override / isolate / mark codepoints. Stripping
 * these prevents an author from visually presenting a forbidden term
 * inside an apparently benign sentence while the underlying codepoint
 * sequence reads differently.
 *
 *   U+200E  LEFT-TO-RIGHT MARK
 *   U+200F  RIGHT-TO-LEFT MARK
 *   U+202A  LEFT-TO-RIGHT EMBEDDING
 *   U+202B  RIGHT-TO-LEFT EMBEDDING
 *   U+202C  POP DIRECTIONAL FORMATTING
 *   U+202D  LEFT-TO-RIGHT OVERRIDE
 *   U+202E  RIGHT-TO-LEFT OVERRIDE
 *   U+2066  LEFT-TO-RIGHT ISOLATE
 *   U+2067  RIGHT-TO-LEFT ISOLATE
 *   U+2068  FIRST STRONG ISOLATE
 *   U+2069  POP DIRECTIONAL ISOLATE
 */
const BIDI_CONTROL_CHARS = /[\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g;
// ─── Errors ──────────────────────────────────────────────────────────────────
/**
 * Thrown by canonicalizeForSafety when the input cannot be canonicalized.
 * Callers must treat this as fail-closed: block the operation, do not
 * downgrade to a warning, do not pass uncanonicalized input to detectors.
 */
export class CanonicalizationError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = "CanonicalizationError";
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}
// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Canonicalize an input string for safety-detector consumption.
 *
 * Apply NFKC normalization, then strip zero-width and bidirectional
 * control codepoints. The output of this function is what gets fed to
 * downstream detectors; the raw input is preserved separately by callers
 * for audit purposes.
 *
 * @param raw  The input string as supplied by the user / agent / caller.
 * @returns    The canonicalized string.
 * @throws     {CanonicalizationError} if `raw` is not a string, or if any
 *             stage of canonicalization fails. Callers must treat a thrown
 *             CanonicalizationError as a blocking outcome (fail-closed).
 */
export function canonicalizeForSafety(raw) {
    if (typeof raw !== "string") {
        throw new CanonicalizationError("Input is not a string; canonicalization aborted.");
    }
    let normalized;
    try {
        normalized = raw.normalize("NFKC");
    }
    catch (err) {
        throw new CanonicalizationError("NFKC normalization failed; canonicalization aborted.", err);
    }
    let stripped;
    try {
        stripped = normalized
            .replace(ZERO_WIDTH_CHARS, "")
            .replace(BIDI_CONTROL_CHARS, "");
    }
    catch (err) {
        throw new CanonicalizationError("Zero-width / bidi stripping failed; canonicalization aborted.", err);
    }
    return stripped;
}
//# sourceMappingURL=canonicalize.js.map