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
 * Rewrite a recognized high-confidence create-folder/create-file near-miss into
 * its canonical verb form. Returns the input unchanged when no high-confidence
 * rewrite applies (the common case).
 */
export declare function canonicalizeNearMiss(text: string): string;
//# sourceMappingURL=near-miss-canonicalizer.d.ts.map