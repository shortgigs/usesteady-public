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
import { normalizeNLToIR } from "./nl-to-ir.js";
// ─── Token / vagueness helpers ─────────────────────────────────────────────────
// Quoted-or-bare token (mirrors PATH_TOKEN_RE in nl-to-ir.ts).
const TOKEN = `"[^"]+"|'[^']+'|\\S+`;
const TYPE_NOUNS = new Set([
    "file",
    "folder",
    "directory",
    "dir",
]);
/**
 * Targets with no concrete referent. A rename source / create name that is one
 * of these cannot be honestly clarified with a single follow-up, so the input
 * stays not_recoverable. Aligned with the vague lexicons in nl-to-ir.ts and
 * local-recovery-adapter.ts.
 */
const VAGUE_TARGETS = new Set([
    "it", "this", "that", "them", "those", "these", "here", "there",
    "everything", "all", "stuff", "things", "anything", "something", "nothing",
    "the", "a", "an", "my", "our", "your", "some",
    "code", "data", "project", "app", "repo", "repository", "codebase",
]);
function unquote(raw) {
    const t = raw.trim();
    if ((t.startsWith("\"") && t.endsWith("\"")) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1).trim();
    }
    return t;
}
function isVague(token) {
    return VAGUE_TARGETS.has(token.trim().toLowerCase());
}
function quoteIfNeeded(s) {
    return /\s/.test(s) ? `"${s}"` : s;
}
// ─── Classifier ────────────────────────────────────────────────────────────────
const MISSING_DEST_RE = new RegExp(`^(?:rename|mv|move)\\s+(?:(?:file|folder|directory|dir)\\s+)?(${TOKEN})\\s*$`, "i");
const AMBIGUOUS_CREATE_RE = new RegExp(`^create\\s+(${TOKEN})\\s*$`, "i");
/**
 * Classify a raw NL input into the recoverable taxonomy.
 *
 * Returns `not_recoverable` whenever the input already normalizes to a WILL,
 * or does not match the narrow recoverable predicate. The normalize guard is
 * what keeps this from firing on inputs the parser (or the near-miss
 * canonicalizer) can already commit to.
 */
export function classifyClarifyRecoverability(rawInput) {
    const trimmed = rawInput.trim();
    if (trimmed.length === 0)
        return { kind: "not_recoverable" };
    // Guard: only inputs the canonical parser cannot already commit to are
    // candidates for clarification. This subsumes the near-miss canonicalizer.
    if (normalizeNLToIR(trimmed, "stdin").kind === "ok") {
        return { kind: "not_recoverable" };
    }
    // 1. rename/move with a resolved source but no destination.
    const dest = trimmed.match(MISSING_DEST_RE);
    if (dest?.[1]) {
        const source = unquote(dest[1]);
        if (source.length > 0 && !isVague(source) && !TYPE_NOUNS.has(source.toLowerCase())) {
            return {
                kind: "missing_destination",
                source,
                slot: "destination",
                prompt: `Rename "${source}" to which path?`,
            };
        }
    }
    // 2. create with a resolved name but ambiguous type (no file/folder noun).
    const create = trimmed.match(AMBIGUOUS_CREATE_RE);
    if (create?.[1]) {
        const name = unquote(create[1]);
        if (name.length > 0 && !isVague(name) && !TYPE_NOUNS.has(name.toLowerCase())) {
            return {
                kind: "ambiguous_type",
                name,
                slot: "file_or_folder",
                prompt: `Create "${name}" as a file or a folder?`,
            };
        }
    }
    return { kind: "not_recoverable" };
}
// ─── Reconstruction (re-route, never synthesize) ───────────────────────────────
/**
 * The accepted answers for an `ambiguous_type` clarify turn.
 */
function normalizeTypeAnswer(answer) {
    const a = answer.trim().toLowerCase();
    if (a === "file" || a === "f")
        return "file";
    if (a === "folder" || a === "directory" || a === "dir" || a === "d") {
        return "folder";
    }
    return null;
}
/**
 * Splice the user's clarify answer into a canonical NL string. Returns `null`
 * when the answer is empty or (for ambiguous_type) not a recognized choice —
 * the caller must then fall back to Reflection (fail closed).
 *
 * The returned string is NOT trusted as executable. The caller MUST re-run it
 * through `normalizeNLToIR`; only a successful parse promotes it to a WILL.
 */
export function reconstructClarifiedInput(rec, answer) {
    switch (rec.kind) {
        case "missing_destination": {
            // Allow the user to answer with or without a leading "to ".
            const dest = answer.trim().replace(/^to\s+/i, "").trim();
            if (dest.length === 0)
                return null;
            return `rename ${quoteIfNeeded(rec.source)} to ${quoteIfNeeded(dest)}`;
        }
        case "ambiguous_type": {
            const choice = normalizeTypeAnswer(answer);
            if (choice === null)
                return null;
            return `create ${choice} ${quoteIfNeeded(rec.name)}`;
        }
        case "not_recoverable":
            return null;
    }
}
//# sourceMappingURL=clarify-recoverability.js.map