/**
 * src/input/cli-error.ts
 *
 * M3 — `CliError` discriminated union.
 *
 * Per design §6 (`docs/CLI_INPUT_NORMALIZATION_DESIGN.md` v2.2) the canonical
 * pipeline emits exactly three failure stages:
 *
 *   ┌───────────┐   ┌───────────┐   ┌──────────┐
 *   │ normalize │ → │  validate │ → │  execute │
 *   └───────────┘   └───────────┘   └──────────┘
 *
 * Each stage emits a `CliError` of its own variant. M3 introduces only the
 * `validate` and `execute` variants because the normalize stage is wired in
 * M4 (NL surface). The `input` and `normalize` stages are forward-declared
 * here so M4/M5 do not need to widen the discriminated union later — they
 * just emit the variants that already exist.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M3 contract (load-bearing — see design §6.5)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  1. `stage` is a verb (pipeline phase), never the noun-of-the-component.
 *     The full enum is `"input" | "normalize" | "validate" | "execute"`.
 *     The noun form (e.g. `"validator"`) is forbidden by §6.5.1 rule 4.
 *
 *  2. Validator-stage and execute-stage `code` constants are identical for
 *     the same root cause (§6.5.1 rule 3). A failure that is `target_exists`
 *     at the validator is also `target_exists` at the executor. Machine
 *     consumers branching on `error` (the surface field in --output json)
 *     see no difference; only `stage` differs.
 *
 *  3. The validator does not introduce new error code constants in M3
 *     (§6.5.1 rule 6). It emits `target_exists`, `file_not_found`, and
 *     `merge_conflict` — all already in the public Adapter-layer enum
 *     documented in `src/shell/cli/use-steady.ts`.
 *
 *     Post-M3 widening (S1 / #26): `invalid_path` is a NEW canonical code
 *     introduced under the same validator rules — emitted at the validate
 *     stage, refused before any preview / approval / fs probe. It closes
 *     the friction where a null-byte filename was only caught by Node's
 *     `ERR_INVALID_ARG_VALUE` deep in `fs.writeFileSync`, after preview
 *     and approval and after the parent directory had already been
 *     created on disk. See the `CliErrorCode` type below.
 *
 *  4. `delete` on missing path is a deliberate public-surface refinement
 *     (§6.5.2): before M3 this surfaced as `execution_error`; M3 surfaces
 *     it as `file_not_found` from the validate stage. Documented at the
 *     `CliErrorCode` type below.
 *
 * What this file does NOT do:
 *   - It does not own stdin (M5 / SessionController).
 *   - It does not normalize NL (M4).
 *   - It does not throw — `CliError` is returned, never raised.
 */
export {};
//# sourceMappingURL=cli-error.js.map