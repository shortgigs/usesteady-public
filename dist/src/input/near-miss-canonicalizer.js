/**
 * src/input/near-miss-canonicalizer.ts
 *
 * USESTEADY_NEAR_MISS_SYNTHESIS_V1 — deterministic near-miss canonicalizer.
 *
 * ── Purpose ────────────────────────────────────────────────────────────────────
 *
 *   A pure, deterministic rewrite that turns *high-confidence* create-folder /
 *   create-file near-miss NL into the canonical verb forms `normalizeNLToIR`
 *   already accepts, so those requests reach a deterministic SYSTEM WILL
 *   (ApprovalFrame) instead of the SYSTEM SUGGESTS recovery surface.
 *
 *     "make a folder for components"  ->  "create folder components"  (SYSTEM WILL)
 *     "add a file for tests"          ->  "create file tests"         (SYSTEM WILL)
 *
 *   It is a *canonicalizer*, not an interpreter: it only rewrites a recognized
 *   surface phrasing into an equivalent canonical phrasing. The actual NL->IR
 *   dispatch, validation, and approval gate are unchanged downstream.
 *
 * ── Truthfulness rules (false-synthesis must stay ~0) ───────────────────────────
 *
 *   Only the UNAMBIGUOUS create cases are promoted to a canonical form:
 *
 *     create-verb + folder-keyword (and NOT file)  ->  `create folder <name>`
 *     create-verb + file-keyword   (and NOT folder) ->  `create file <name>`
 *
 *   Everything else is returned VERBATIM (no rewrite), so its existing routing
 *   is preserved:
 *     - ambiguous create (neither/both folder & file keyword)  -> stays SUGGESTS
 *     - delete / rename near-misses                            -> stays SUGGESTS
 *     - genuinely vague input ("make this better")             -> stays Reflection
 *     - already-canonical input ("mkdir x", "create folder x") -> unchanged*
 *
 *   *Already-canonical create-folder/create-file inputs canonicalize to the
 *   identical string (a safe no-op); `mkdir`/`touch` are not create-verbs here
 *   so they pass through untouched.
 *
 *   The extracted <name> must be a SINGLE path-safe token (no spaces) and must
 *   not be a vague meta-word. A multi-word subject ("a folder for user
 *   settings") is deliberately NOT synthesized — the runtime cannot pin a
 *   single honest folder name, so it stays on the SUGGESTS path where the
 *   human reviews the adapter's best-effort suggestion.
 *
 *   The canonical output is, by construction, the same string the
 *   `LocalRecoveryAdapter` would have offered as a SYSTEM SUGGESTS for the
 *   unambiguous single-name case — so the promoted SYSTEM WILL never disagrees
 *   with what the suggestion layer would have said.
 *
 * ── Removal invariant ──────────────────────────────────────────────────────────
 *
 *   Delete the single call site in `normalizeNLToIR` and this module has zero
 *   effect: every near-miss falls back to its prior `parse_error` -> recovery
 *   routing. The function is pure and side-effect free.
 */
/**
 * Verbs/articles/type-nouns/prepositions that are never part of a target name.
 * Mirrors the noise lexicon used by `local-recovery-adapter.ts` so the WILL
 * path and the SUGGESTS path extract the same name for the same input.
 */
const NOISE_WORDS = new Set([
    // create-family verbs (+ "set up"/"setup" particles)
    "create", "make", "add", "new", "build", "generate", "set", "up", "setup",
    // structural type nouns
    "folder", "directory", "dir", "file",
    // articles / determiners
    "a", "an", "the", "my", "our", "your", "some", "this", "that",
    // prepositions / connectors
    "for", "to", "in", "at", "on", "from", "into", "of", "with",
    // filler / anchors
    "it", "one", "please", "called", "named",
]);
/**
 * Vague meta-words that must never become a synthesized path. Mirrors
 * `VAGUE_NAMES` in `local-recovery-adapter.ts`.
 */
const VAGUE_NAMES = new Set([
    "everything", "all", "files", "stuff", "things", "anything", "something",
    "nothing", "them", "those", "these", "here", "there", "data", "code",
    "project", "app", "repo", "repository", "codebase",
]);
/** A single, path-safe token: letters/digits and the usual path punctuation. */
const PATH_SAFE_TOKEN = /^[A-Za-z0-9._/-]+$/;
const CREATE_VERB = /\b(?:create|make|add|new|build|generate|set\s+up|setup)\b/i;
const DIR_KEYWORD = /\b(?:folder|directory|dir)\b/i;
const FILE_KEYWORD = /\bfile\b/i;
/**
 * A type-noun used as a prepositional DESTINATION ("add structure to the
 * folder", "put it into the file") is NOT the thing being created — it names an
 * existing container. In that shape the type-noun must not drive create-folder /
 * create-file canonicalization, or the residual object of the verb ("structure")
 * is fabricated into a folder name. The legitimate create shapes
 * ("make a folder for components", "add a file for tests") use "for"/articles,
 * never "to/into/in <type-noun>", so they are unaffected.
 */
const DESTINATION_TYPE_NOUN = /\b(?:to|into|in|inside|within|onto|from)\s+(?:(?:the|a|an|this|that|my|our|your)\s+)?(?:folders?|director(?:y|ies)|dirs?|files?)\b/i;
/**
 * Rewrite a recognized high-confidence create-folder/create-file near-miss into
 * its canonical verb form. Returns the input unchanged when no high-confidence
 * rewrite applies (the common case).
 */
export function canonicalizeNearMiss(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return text;
    if (!CREATE_VERB.test(trimmed))
        return text;
    // Destination guard: when the only folder/file keyword is a prepositional
    // destination ("... to the folder"), it does not name the created thing.
    // Leave such inputs verbatim so they do not synthesize a fabricated create.
    if (DESTINATION_TYPE_NOUN.test(trimmed))
        return text;
    const isDir = DIR_KEYWORD.test(trimmed);
    const isFile = FILE_KEYWORD.test(trimmed);
    // Require an UNAMBIGUOUS type: exactly one of folder/file. Neither (no type
    // noun) or both (conflicting) is left for the SUGGESTS/Reflection path.
    if (isDir === isFile)
        return text;
    const name = extractSingleName(trimmed);
    if (name === null)
        return text;
    return isDir ? `create folder ${name}` : `create file ${name}`;
}
/**
 * Extract a single, unambiguous target name, or null if no honest single-token
 * name can be derived.
 *
 *   1. "called <X>" / "named <X>" anchor wins (most explicit).
 *   2. Otherwise strip noise words and require EXACTLY ONE remaining token.
 */
function extractSingleName(text) {
    const anchor = /\b(?:called|named)\s+(\S+)/i.exec(text);
    if (anchor?.[1]) {
        return sanitizeName(anchor[1]);
    }
    const tokens = text
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && !NOISE_WORDS.has(t.toLowerCase()));
    // Truthfulness gate: only a single residual token is a confident name.
    // Multi-token subjects ("user settings") cannot be pinned to one honest
    // path, so they are not synthesized.
    if (tokens.length !== 1)
        return null;
    return sanitizeName(tokens[0]);
}
/**
 * Normalize a candidate name to a single safe path token, or null if it is not
 * a usable, non-vague, path-safe token.
 */
function sanitizeName(raw) {
    let t = raw.trim();
    // Strip a single layer of wrapping quotes.
    if ((t.startsWith("\"") && t.endsWith("\"")) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1).trim();
    }
    // Strip trailing sentence punctuation ("components." -> "components"), but
    // keep internal dots ("utils.ts" stays intact).
    t = t.replace(/[.,!?;:]+$/g, "");
    if (t.length === 0)
        return null;
    if (!PATH_SAFE_TOKEN.test(t))
        return null;
    if (t.includes(".."))
        return null; // no path traversal
    const low = t.toLowerCase();
    if (VAGUE_NAMES.has(low) || NOISE_WORDS.has(low))
        return null;
    return t;
}
//# sourceMappingURL=near-miss-canonicalizer.js.map