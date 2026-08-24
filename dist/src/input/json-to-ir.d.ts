/**
 * src/input/json-to-ir.ts
 *
 * M2 — JSON / batch surface adapter.
 *
 * Pure function from a JSON-parsed array of public-schema ops to IR. No I/O,
 * no logging, no process exits. Callers handle errors at the CLI boundary.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M2 contract (load-bearing — do not relax)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  1. Identical-behavior guarantee.
 *     The accept/reject decision and the field-extraction semantics for every
 *     possible JSON op MUST be byte-equivalent to `jsonOpToDraftTask` in
 *     `src/shell/cli/draft/intent-to-tasks.ts`. That function is the wire-
 *     level definition of the public --json / batch contract. M2 changes the
 *     spine (DraftTask → IR → DraftTask via the `ir-to-draft` shim) without
 *     changing the contract.
 *
 *  2. Public schema is 8 ops (post-S2 contract repair).
 *     Per design §10 #7 (D3) the M2 release shipped 7 ops. Post-alpha.47
 *     audit (CLI Contract Audit / friction "create_dir invalid_op")
 *     promoted `create_dir` to the public --json / batch schema because
 *     every layer beneath this adapter (IR, validator, workflow
 *     coordinator, in-process adapter) already supported it end-to-end
 *     — only this adapter and HELP_TEXT were missing. The accepted
 *     shape is `{ "type": "create_dir", "path": "<path>" }`. Field name
 *     `path` is used (not `file`) because the IR uses `path` for this op
 *     and `create_dir` is conceptually a directory, not a file. No
 *     `file` alias is accepted — surface stays unambiguous.
 *
 *  3. The OperationRegistry is the type gate.
 *     `isKnownOperationType` from `op-registry.ts` is consulted to reject
 *     unknown `type` values up front. Field-shape validation lives here
 *     because the public JSON schema's field names (`from` / `to` / `file`)
 *     differ from the IR's arg names (`path` / `from` / `to` / `file` /
 *     `text` / `command`) — the registry can't validate the public shape.
 *
 *  4. No public-schema extension and no behavior change.
 *     Every JSON op the legacy path accepted is still accepted. Every JSON
 *     op the legacy path rejected is still rejected, with the same per-op
 *     short-circuit semantics (see `buildIRFromJsonOps`).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  What this file deliberately does NOT do
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   - It does not produce structured `CliError` objects (M3 / design §6).
 *   - It does not feasibility-check (M3 / design §3.3).
 *   - It does not normalize NL (M4).
 *   - It does not own stdin (M5 / design §3.4).
 *   - It does not fix GH-22 / GH-23 / GH-24. Those frictions remain
 *     `status/pending` and unblock at later milestones per design §9.
 */
import type { IR, IRSourceSurface, Operation } from "./ir.js";
export type JsonToIRResult = {
    readonly kind: "ok";
    readonly ir: IR;
} | {
    readonly kind: "error";
    readonly index: number;
    readonly raw: unknown;
};
/**
 * Convert a single raw JSON op (as produced by `JSON.parse`) to an IR
 * `Operation`. Returns `null` if the op is not a valid public JSON op.
 *
 * The `null` return case is exhaustively defined by the legacy
 * `jsonOpToDraftTask` function — every shape that previously returned `null`
 * still returns `null`, and every shape that previously returned a
 * `DraftTask` now returns the corresponding IR `Operation`.
 *
 * Notable design-vs-public-schema gaps and how they are bridged:
 *
 *   - `replace.occurrence` is required by IR §5.1 ("never undefined") but
 *     is NOT in the public JSON schema. M2 sets it to a fixed default of
 *     "all" so the IR shape is satisfied. The downstream M2 shim
 *     (`irOperationToJsonDraftTask`) drops this field on the way back to
 *     `DraftTask`, so no behavior changes. M3 will decide whether to
 *     surface `occurrence` on the public schema or keep the adapter-side
 *     default; that's an M3 conversation, not M2's problem.
 *
 *     usesteady-public#45 update: the JSON adapter now ALSO reads an
 *     optional `occurrence` field when the caller provides it. The value
 *     is parsed and recorded on the IR as `requestedOccurrence` (the
 *     user's explicit directive). The existing `occurrence` default
 *     ("all") is preserved for byte-identical behavior on the no-field
 *     path. Validate-stage refusal handles non-"first" directives (see
 *     `feasibility-validator.ts`). The capabilities summary documents
 *     the actual support state — see `op-registry.ts`.
 *
 *   - `create.contents` is omitted because the public JSON `create` op
 *     does not accept `contents`. The IR field is optional in §5.1, so
 *     this is a faithful representation.
 *
 *   - `create_dir` accepts `{ "type": "create_dir", "path": "<path>" }`.
 *     Path field is `path` (matches IR shape and the directory semantics);
 *     `file` is intentionally not aliased here.
 */
export declare function jsonOpToIROperation(raw: unknown): Operation | null;
/**
 * Build IR from a JSON-parsed array of public-schema ops.
 *
 * On the first invalid op, returns `kind: "error"` with the op's index in
 * the input array and the original raw value (for the caller to surface in
 * the error message). This matches the legacy per-op short-circuit behavior
 * in `processJsonInput`.
 *
 * The CLI wire-in (`processJsonInput`) does NOT use this aggregator
 * directly — it walks the array op-by-op so that the existing per-op shadow-
 * envelope persistence semantics are preserved (envelopes for ops [0..i-1]
 * are written to disk before the loop exits on op [i]). This aggregator
 * exists so tests can assert IR shape on whole-array inputs and so future
 * milestones (M3 validator) have a clean entry point.
 *
 * The `surface` parameter is `"json"` for `--json` invocations and
 * `"batch"` for the `batch <file>` subcommand. Both share `processJsonInput`
 * so the same adapter is correct for both — only this metadata differs.
 */
export declare function buildIRFromJsonOps(ops: readonly unknown[], rawSource: string, surface: IRSourceSurface & ("json" | "batch")): JsonToIRResult;
/**
 * If `raw` is a JSON op that `jsonOpToIROperation` would reject because a
 * specific required public-wire field is missing, return a human-readable
 * line naming that field. Otherwise return `null` (caller falls back to
 * the existing generic message).
 *
 * Pure: no I/O, no mutation, no logging.
 */
export declare function diagnoseInvalidJsonOp(raw: unknown): string | null;
//# sourceMappingURL=json-to-ir.d.ts.map