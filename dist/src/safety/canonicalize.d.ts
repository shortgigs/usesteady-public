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
/**
 * Thrown by canonicalizeForSafety when the input cannot be canonicalized.
 * Callers must treat this as fail-closed: block the operation, do not
 * downgrade to a warning, do not pass uncanonicalized input to detectors.
 */
export declare class CanonicalizationError extends Error {
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown);
}
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
export declare function canonicalizeForSafety(raw: string): string;
//# sourceMappingURL=canonicalize.d.ts.map