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
import type { Operation } from "./ir.js";
/**
 * Pipeline stages, verbs only. Forward-declared in full so later milestones
 * do not need to widen this type.
 *
 * - `input`    : argv parsing, stdin handling (M5).
 * - `normalize`: surface-specific text/JSON → IR conversion (M2 for JSON,
 *                M4 for NL). Today the JSON adapter exits the process on
 *                normalize failure rather than returning `CliError`; the
 *                migration to a returned `CliError` lands with M5's
 *                SessionController.
 * - `validate` : path-level feasibility checks on IR (M3, this milestone).
 * - `execute`  : runtime side effects (the existing executor).
 */
export type CliErrorStage = "input" | "normalize" | "validate" | "execute";
/**
 * The closed set of error codes the canonical pipeline can emit.
 *
 * Mirrors the documented public enum in `src/shell/cli/use-steady.ts`'s
 * JSDoc header. Keep these in sync — the doc is the public contract; this
 * type is the internal enforcement of that contract.
 *
 * The enum is intentionally NOT split into "validator-emitted" vs
 * "executor-emitted" subsets at the type level. §6.5.1 rule 3 requires that
 * the same root cause emits the same code from both stages, so any future
 * partition would be a footgun (a code surfaced from both stages would have
 * to live in two type aliases).
 *
 * Validator-emitted subset in M3 (the codes the M3 FeasibilityValidator
 * originally emitted): `target_exists`, `file_not_found`, `merge_conflict`.
 * The executor continues to emit the broader set; M3 did not migrate those.
 *
 * Post-M3 widening — validator-emitted (S1 / friction #26):
 *   `invalid_path` — refused at the validate stage when an op's path-
 *   bearing field contains a null byte. Refused before preview / approval /
 *   any fs probe. No mutation. The pre-fix behavior was a raw Node
 *   `TypeError [ERR_INVALID_ARG_VALUE]` from `fs.writeFileSync` deep in
 *   the executor, surfaced as the catchall `execution_error` after the
 *   parent directory had been created on disk.
 *
 * Post-M3 widening — validator-emitted + executor-defense (S2 / friction #36):
 *   `outside_workspace` — refused when an op's path-bearing field resolves
 *   outside the workspace root. Catches POSIX absolute (`/etc/x`), Windows
 *   drive-rooted (`C:\x`, `C:/x`), Windows drive-relative (`C:foo`), UNC
 *   (`\\srv\share\x`, `//srv/share/x`), and `..`-traversal-after-normalize
 *   (`a/../../etc`). Refused at the validate stage before any preview /
 *   approval / fs probe. The CursorInProcessAdapter additionally re-checks
 *   the resolved absolute path at every fs case as defense-in-depth — same
 *   posture K4-I3 takes for replay (the K4 sandbox does not depend on a
 *   single check site). The pre-fix behavior on the JSON / batch surfaces
 *   was silent fs mutation outside the workspace at exit 0 success, with
 *   no safety block, no error code, no telemetry signal.
 *
 *   This code is shared between the validator stage (where it normally
 *   fires) and the executor stage (where the defense-in-depth re-check
 *   surfaces it as `errorCode` on the cursor-session refusal). §6.5.1
 *   rule 3 — same root cause, same code, regardless of stage.
 */
export type CliErrorCode = "target_exists" | "file_not_found" | "merge_conflict" | "old_value_not_found" | "ambiguous_match" | "scope_outside_allowed" | "prohibited_pattern_match" | "parse_error" | "delivery_timeout" | "invalid_path" | "outside_workspace" | "invalid_filename_chars" | "invalid_replacement_chars" | "invalid_filename_reserved_name" | "prohibited_path" | "execution_error";
/**
 * Validator-stage error. Emitted by `FeasibilityValidator` (M3).
 *
 * `operation` is the IR `Operation` the validator refused. Carrying the
 * full op (not just an index) lets the CLI surface a precise diagnostic
 * without re-walking the IR.
 */
export type ValidateError = {
    readonly stage: "validate";
    readonly code: CliErrorCode;
    readonly message: string;
    readonly operation: Operation;
    /** Index of the offending op in the IR's `operations` array. */
    readonly index: number;
};
/**
 * Execute-stage error. Forward-declared for parity with the design's three-
 * stage model. M3 does not emit this variant — the existing executor still
 * surfaces its errors through the `executeFsOp` return shape and the cursor
 * `executionResult` field. The migration of those code paths to return a
 * `CliError` lands with M5 / M6 when the legacy DraftTask layer is retired.
 */
export type ExecuteError = {
    readonly stage: "execute";
    readonly code: CliErrorCode;
    readonly message: string;
    readonly operation: Operation;
};
/**
 * Normalize-stage error. Forward-declared for parity with the design's
 * three-stage model. M3 does not emit this variant. M4 (NL normalizer)
 * will emit it; M2's JSON adapter currently exits the process on
 * normalize failure (predates this type) and is migrated to return this
 * variant in M5.
 *
 * `surface` is the IR source surface (`"json"` / `"prompt"` / `"positional"`
 * / `"batch"` / `"repl"`); `raw` is the verbatim input the surface received.
 */
export type NormalizeError = {
    readonly stage: "normalize";
    readonly code: CliErrorCode;
    readonly message: string;
    readonly surface: string;
    readonly raw: string;
};
/**
 * Input-stage error (argv parsing, stdin handling). Forward-declared for
 * M5 (SessionController). M3 does not emit this variant.
 */
export type InputError = {
    readonly stage: "input";
    readonly code: CliErrorCode;
    readonly message: string;
};
/**
 * The canonical `CliError` discriminated union. Consumers branch on `stage`.
 *
 * In M3, the only variant a runtime construction site emits is
 * `ValidateError`. The other three exist as forward-declared variants so
 * later milestones add code paths, not type widenings.
 */
export type CliError = InputError | NormalizeError | ValidateError | ExecuteError;
//# sourceMappingURL=cli-error.d.ts.map