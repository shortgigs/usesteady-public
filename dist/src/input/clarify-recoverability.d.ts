/**
 * src/input/clarify-recoverability.ts
 *
 * USESTEADY_CLARIFY_THEN_PROMOTE_V1 — Phase 1: the `recoverable` discriminator.
 *
 * ── Purpose ────────────────────────────────────────────────────────────────────
 *
 *   A pure, deterministic classifier over an NL input that `normalizeNLToIR`
 *   could NOT commit to an IR. It decides whether the failure is recoverable
 *   with exactly ONE clarification (a missing destination, or a file-vs-folder
 *   choice) vs genuinely not recoverable (vague intent, multi-slot gaps).
 *
 *   This phase adds NO UI and NO interactive loop. It is the data contract the
 *   CLI and web clarify turns (Phases 2-3) will both consume.
 *
 * ── The truthfulness contract (load-bearing) ───────────────────────────────────
 *
 *   This module NEVER synthesizes an operation. `classifyClarifyRecoverability`
 *   only names the single missing slot; `reconstructClarifiedInput` only splices
 *   the user's answer into a canonical NL string. The promotion to a concrete
 *   SYSTEM WILL is produced solely by re-running `normalizeNLToIR` on the
 *   reconstructed string (the caller's job). If that re-parse fails, the caller
 *   falls back to Reflection. There is no path here that fabricates a WILL.
 *
 * ── Narrow predicate (V1 — deliberately conservative) ──────────────────────────
 *
 *   Only two classes qualify; everything else returns `not_recoverable`:
 *
 *     1. missing_destination — `rename|mv|move <source>` with a single resolved
 *        source token and NO destination. Clarify slot: the destination path.
 *     2. ambiguous_type      — `create <name>` with a single resolved name and
 *        NO file/folder type noun. Clarify slot: file vs folder.
 *
 *   Out of V1 (stay Reflection): vague targets, multi-word sources,
 *   `add X to <existing-file>` (needs content, not one token), missing-name
 *   creates, and anything that already normalizes to a WILL.
 *
 * ── Removal invariant ──────────────────────────────────────────────────────────
 *
 *   This module is pure and has zero side effects. Deleting its call sites
 *   leaves every input on its prior `parse_error` -> Reflection routing.
 */
/**
 * The result of classifying a non-normalizable NL input. Plain data only (no
 * functions) so it serializes across the web clarify turn (Phase 3).
 */
export type ClarifyRecoverability = {
    readonly kind: "missing_destination";
    /** The resolved rename source (unquoted). */
    readonly source: string;
    /** The single slot the clarify turn must fill. */
    readonly slot: "destination";
    /** Human-facing question for the clarify turn. */
    readonly prompt: string;
} | {
    readonly kind: "ambiguous_type";
    /** The resolved create target name (unquoted). */
    readonly name: string;
    readonly slot: "file_or_folder";
    readonly prompt: string;
} | {
    readonly kind: "not_recoverable";
};
/**
 * Classify a raw NL input into the recoverable taxonomy.
 *
 * Returns `not_recoverable` whenever the input already normalizes to a WILL,
 * or does not match the narrow recoverable predicate. The normalize guard is
 * what keeps this from firing on inputs the parser (or the near-miss
 * canonicalizer) can already commit to.
 */
export declare function classifyClarifyRecoverability(rawInput: string): ClarifyRecoverability;
/**
 * Splice the user's clarify answer into a canonical NL string. Returns `null`
 * when the answer is empty or (for ambiguous_type) not a recognized choice —
 * the caller must then fall back to Reflection (fail closed).
 *
 * The returned string is NOT trusted as executable. The caller MUST re-run it
 * through `normalizeNLToIR`; only a successful parse promotes it to a WILL.
 */
export declare function reconstructClarifiedInput(rec: ClarifyRecoverability, answer: string): string | null;
//# sourceMappingURL=clarify-recoverability.d.ts.map