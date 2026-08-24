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
import type { ParsedChange } from "./types.js";
export type ParsedIntent = {
    readonly kind: "create_dir";
    readonly path: string;
} | {
    readonly kind: "create_file";
    readonly path: string;
    readonly content?: string;
} | {
    readonly kind: "rename";
    readonly from: string;
    readonly to: string;
} | {
    readonly kind: "delete";
    readonly path: string;
} | {
    readonly kind: "replace";
    readonly find: string;
    readonly replace: string;
    readonly file: string;
};
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
export declare function normalizeIntent(raw: string): ParsedIntent | null;
/**
 * Convert a ParsedIntent into the canonical ParsedChange used by the execution
 * pipeline (FsChange | ReplaceChange).
 *
 * This is the only bridge between the normalizer and the execution path.
 * No new execution paths are introduced here.
 */
export declare function intentToChange(intent: ParsedIntent): ParsedChange;
/**
 * Human-readable "SYSTEM WILL:" description for a ParsedIntent.
 * Used in the UI approval frame to surface normalised intent to the user.
 */
export declare function describeIntent(intent: ParsedIntent): string;
//# sourceMappingURL=intent.d.ts.map