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
import type { IR } from "./ir.js";
import type { NormalizeError } from "./cli-error.js";
/**
 * The three NL input surfaces M4 wires. Cursor REPL and credential-gate
 * readline remain on the legacy path until M5 (§6.6.3).
 *
 *   - "prompt"     — `--prompt "..."` flag
 *   - "positional" — bare positional argv NL (after R1 multi-token argv join)
 *   - "stdin"      — piped stdin (non-TTY, no subcommand)
 *
 * These map to `IRSourceSurface` values "prompt" and "positional" for
 * diagnostics. Stdin groups with "prompt" for the `source.surface` field
 * because the M2 IR type (`src/input/ir.ts`) does not list "stdin" as a
 * surface and design §5.1 is the source of truth. The verbatim input text is
 * still preserved in `source.raw` either way. (Widening `IRSourceSurface` is
 * deferred to a later milestone to keep M4's diff inside `src/input/` new
 * files and the three wiring touches in `use-steady.ts`.)
 */
export type NLSurface = "prompt" | "positional" | "stdin";
export type NLToIRResult = {
    readonly kind: "ok";
    readonly ir: IR;
} | {
    readonly kind: "error";
    readonly error: NormalizeError;
};
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
export declare function normalizeNLToIR(input: string, surface: NLSurface): NLToIRResult;
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
export declare function detectDuplicatePromptFlag(rawArgs: readonly string[]): boolean;
//# sourceMappingURL=nl-to-ir.d.ts.map