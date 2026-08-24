/**
 * Context Alignment — semantic classification of input vs. session context.
 *
 * CONTRACT (PRV / Context Alignment boundary):
 *   Context Alignment is SEMANTIC. It handles context-reference patterns that are
 *   too specific or phrase-dependent for PRV's lexical approach.
 *
 *   PRV handles: again, continue, previous, same as
 *   Context Alignment handles: same file, use same, that file, my project, the config
 *
 *   Both layers may detect context-dependency, but for different reasons:
 *     PRV:               "is this input lexically dependent on missing state?"
 *     Context Alignment: "does this input reference a specific artifact that requires context?"
 */
// ─── Non-literal patterns (social / conversational) ───────────────────────────
const NON_LITERAL_PATTERNS = [
    /^\s*good\s+(morning|afternoon|evening|night)\b/i,
    /^\s*(hello|hi|hey)\b/i,
    /^\s*let'?s?\s+(?:get\s+)?start(?:ed)?\b/i,
    /^\s*how\s+are\s+you\b/i,
    /^\s*thanks?\b/i,
    /^\s*thank\s+you\b/i,
    /^\s*ok(ay)?\b/i,
    /^\s*great\b/i,
    /^\s*sounds\s+good\b/i,
];
// ─── Context-reference patterns ────────────────────────────────────────────────
// Specific semantic references to prior session artifacts or state.
// These are narrower than PRV's lexical markers — they identify the OBJECT
// being referenced, not just the existence of a reference word.
const CONTEXT_REFERENCE_PATTERNS = [
    // File / artifact references
    /\bsame\s+file\b/i,
    /\bthat\s+file\b/i,
    /\bthat\s+result\b/i,
    /\bthat\s+approach\b/i,
    // Session / execution references
    /\bprevious\s+run\b/i,
    /\bcontinue\s+from\s+before\b/i,
    /\buse\s+the\s+same\b/i,
    /\buse\s+same\b/i, // "use same file" (without "the")
    // Config / project references without concrete identifiers
    // (these are moved here from disambiguation to keep responsibility clear)
    /\bmy\s+project\b/i,
    /\bthe\s+config\b(?![\s".])/i, // "the config" without a following path/quote
];
export function runContextAlignment(input, ctx) {
    if (NON_LITERAL_PATTERNS.some((p) => p.test(input))) {
        return { kind: "non_literal" };
    }
    if (CONTEXT_REFERENCE_PATTERNS.some((p) => p.test(input))) {
        if (!ctx.hasPriorSession) {
            return {
                kind: "hard_mismatch",
                reason: "Input references a prior session or result, but no prior context is available.",
            };
        }
    }
    return { kind: "aligned" };
}
//# sourceMappingURL=context-alignment.js.map