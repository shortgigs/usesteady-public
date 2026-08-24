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
import { isKnownOperationType } from "./op-registry.js";
import { PUBLIC_JSON_SCHEMA } from "./public-json-schema.js";
function parseJsonOccurrence(raw) {
    if (raw === undefined)
        return { kind: "absent" };
    // `null` is treated as malformed rather than absent: callers who do
    // not want to express a directive should omit the field entirely.
    if (raw === null)
        return { kind: "invalid" };
    if (typeof raw === "string") {
        if (raw === "first" || raw === "all") {
            return { kind: "parsed", value: raw };
        }
        return { kind: "invalid" };
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
        const obj = raw;
        const idx = obj["index"];
        if (typeof idx === "number" && Number.isInteger(idx) && idx >= 1) {
            return { kind: "parsed", value: { index: idx } };
        }
        return { kind: "invalid" };
    }
    return { kind: "invalid" };
}
// ─── Field helpers (mirror jsonOpToDraftTask exactly) ────────────────────────
//
// `stripWrappingQuotes` and `normalizePathToken` are intentional copies of
// the helpers in `src/shell/cli/draft/intent-to-tasks.ts`. M2 does not import
// them from there because:
//
//   - That module owns the NL draft layer and is slated for replacement in
//     M4. Importing across the boundary couples M2 to a deprecated module.
//   - The helpers are 8 lines total; the duplication cost is much smaller
//     than the coupling cost. M4 deletes the draft-layer copy when it
//     deletes the rest of the draft layer.
//
// If either copy ever drifts, the identical-behavior tests
// (`tests/input/json-to-ir.identical-behavior.test.ts`) fail loudly.
function stripWrappingQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function normalizePathToken(value) {
    const out = stripWrappingQuotes(value);
    return out.length > 0 ? out : null;
}
function strField(op, name) {
    const v = op[name];
    return typeof v === "string" ? v : undefined;
}
// ─── Per-op adapter ──────────────────────────────────────────────────────────
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
export function jsonOpToIROperation(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const op = raw;
    const typeRaw = op["type"];
    if (typeof typeRaw !== "string")
        return null;
    if (!isKnownOperationType(typeRaw))
        return null;
    const from = strField(op, "from");
    const to = strField(op, "to");
    const fileRaw = strField(op, "file");
    const file = fileRaw !== undefined ? normalizePathToken(fileRaw) : undefined;
    const pathRaw = strField(op, "path");
    const path = pathRaw !== undefined ? normalizePathToken(pathRaw) : undefined;
    switch (typeRaw) {
        case "rename": {
            if (from === undefined || to === undefined)
                return null;
            const f = from.trim();
            const t = to.trim();
            if (f.length === 0 || t.length === 0)
                return null;
            return { type: "rename", args: { from: f, to: t } };
        }
        case "replace": {
            if (from === undefined || to === undefined || file === null || file === undefined)
                return null;
            // `from` non-empty check uses raw length (no trim) — matches
            // jsonOpToDraftTask exactly; replacing an empty string is undefined.
            if (from.length === 0)
                return null;
            // usesteady-public#45 — parse the optional `occurrence` field. Three
            // cases:
            //   - absent  → no user directive; IR `occurrence` keeps the
            //               adapter-side "all" default (byte-identical to the
            //               pre-#45 path). `requestedOccurrence` stays
            //               undefined so validator / preview / diagnostics
            //               know the user did not specify.
            //   - parsed  → user directive populated on `requestedOccurrence`;
            //               IR `occurrence` mirrors the same value (the
            //               existing default "all" is replaced by the user's
            //               chosen directive so the executor's downstream
            //               match logic — which still ignores occurrence —
            //               at least sees a consistent IR view).
            //   - invalid → malformed `occurrence` field, JSON op fails to
            //               convert. Same short-circuit as any malformed
            //               field. Caller surfaces `invalid_op` per the
            //               existing per-op contract.
            const occParse = parseJsonOccurrence(op["occurrence"]);
            if (occParse.kind === "invalid")
                return null;
            const occurrence = occParse.kind === "parsed" ? occParse.value : "all";
            const requestedOccurrence = occParse.kind === "parsed" ? occParse.value : undefined;
            return {
                type: "replace",
                args: {
                    file,
                    from,
                    to,
                    occurrence,
                    ...(requestedOccurrence !== undefined ? { requestedOccurrence } : {}),
                },
            };
        }
        case "create": {
            if (file === null || file === undefined)
                return null;
            return { type: "create", args: { path: file } };
        }
        case "create_dir": {
            if (path === null || path === undefined)
                return null;
            return { type: "create_dir", args: { path } };
        }
        case "delete": {
            if (file === null || file === undefined)
                return null;
            return { type: "delete", args: { path: file } };
        }
        case "run": {
            if (to === undefined || to.trim().length === 0)
                return null;
            return { type: "run", args: { command: to.trim() } };
        }
        case "append": {
            if (to === undefined || file === null || file === undefined)
                return null;
            return { type: "append", args: { file, text: to } };
        }
        case "prepend": {
            if (to === undefined || file === null || file === undefined)
                return null;
            return { type: "prepend", args: { file, text: to } };
        }
        // Any future IR op added by a later milestone is rejected here until
        // its public-schema RFC lands.
        default:
            return null;
    }
}
// ─── Aggregator ──────────────────────────────────────────────────────────────
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
export function buildIRFromJsonOps(ops, rawSource, surface) {
    const operations = [];
    for (let i = 0; i < ops.length; i++) {
        const irOp = jsonOpToIROperation(ops[i]);
        if (irOp === null) {
            return { kind: "error", index: i, raw: ops[i] };
        }
        operations.push(irOp);
    }
    const ir = {
        operations,
        source: { surface, raw: rawSource },
    };
    return { kind: "ok", ir };
}
// ─── Diagnostic enrichment (R-alpha-min) ──────────────────────────────────────
//
// `jsonOpToIROperation` returns `null` for any op that does not pass the
// public-schema accept/reject test. That is the load-bearing decision and
// MUST NOT change shape — every existing test fixture pins it byte-for-byte.
//
// What WAS missing before R-alpha-min: the CLI's user-facing message on
// rejection was generic ("unknown or invalid operation: <verbatim JSON>"),
// and the public JSON output payload was the equally generic
// `{ "success": false, "error": "invalid_op" }`. A user who omitted a
// single required field (typo, copy-paste from a wrong example, etc.) got
// no signal about which field, and the friction was sometimes reported as
// "the JSON schema is undiscoverable from the error message".
//
// `diagnoseInvalidJsonOp` consults `PUBLIC_JSON_SCHEMA` (the wire-shape
// companion) and produces a human-readable explanation naming the specific
// missing required field, using the exact key the operator would have
// typed. Returns `null` when no specific reason is identifiable (unknown
// op type, missing `type`, non-object input, etc.) — the caller then falls
// back to the existing generic message.
//
// Scope discipline (load-bearing — R-alpha-min):
//   - Accept/reject boundary unchanged. Every input that returns null from
//     `jsonOpToIROperation` still returns null. Every input that returns
//     an `Operation` still returns the identical `Operation`. This
//     function does not gate anything; it only describes.
//   - No new public `CliErrorCode`. The CLI continues to emit
//     `invalid_op` in the JSON output payload; only the stderr human text
//     is enriched.
//   - No unknown-field rejection. A JSON op with an extra unrecognized
//     key (e.g. `{ type: "create", file: "x", extra: 1 }`) is still
//     accepted by `jsonOpToIROperation` (the extra key is dropped by the
//     per-case branches). This function never flags such cases.
//   - The function MUST NOT mutate its input.
//
// Return shape: a single human-readable line, suitable for direct inclusion
// in the CLI's stderr block. Renders one cause per call (the first missing
// required field). If multiple required fields are missing, the operator
// will see the first one and fix it; on the next attempt the second one
// surfaces. This mirrors how typed-language compilers walk required-arg
// lists and avoids the "wall of errors" UX.
/**
 * If `raw` is a JSON op that `jsonOpToIROperation` would reject because a
 * specific required public-wire field is missing, return a human-readable
 * line naming that field. Otherwise return `null` (caller falls back to
 * the existing generic message).
 *
 * Pure: no I/O, no mutation, no logging.
 */
export function diagnoseInvalidJsonOp(raw) {
    // Mirror the structural gates in `jsonOpToIROperation` exactly. Each
    // structural gate returning null below corresponds to a case the generic
    // "unknown or invalid operation" message already handles well (no key
    // to name). Only the per-op required-field branch produces a richer
    // diagnostic.
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const op = raw;
    const typeRaw = op["type"];
    if (typeof typeRaw !== "string")
        return null;
    if (!isKnownOperationType(typeRaw))
        return null;
    const schema = PUBLIC_JSON_SCHEMA[typeRaw];
    // Walk required public-wire field names in declared order. The first
    // field that is structurally absent OR present-but-not-a-string (the
    // adapter requires strings for every field except `occurrence`) names
    // the diagnostic.
    //
    // Note: this intentionally does NOT cover field-content errors like
    // "from is empty" or "occurrence shape is invalid" — those have already-
    // documented rejection semantics in jsonOpToIROperation and the existing
    // generic message remains correct for them. R-alpha-min's scope is
    // "missing required field" only.
    for (const fieldName of schema.required) {
        const value = op[fieldName];
        if (value === undefined) {
            return formatMissingFieldMessage(typeRaw, fieldName);
        }
        if (typeof value !== "string") {
            // The per-case branches return null on non-string required fields
            // (via `strField`). Surface this as a typed-field diagnostic so the
            // operator sees what changed.
            return formatNonStringFieldMessage(typeRaw, fieldName, typeof value);
        }
    }
    // Required fields are all present and string-typed, yet the op was
    // rejected. The root cause is content-level (empty string after
    // normalization, invalid occurrence shape, etc.). Fall through to the
    // generic message — the per-case branch already returned a specific
    // null path that the operator's payload makes obvious on inspection.
    return null;
}
function formatMissingFieldMessage(opType, fieldName) {
    return (`op type "${opType}" requires field "${fieldName}" but it was not provided. ` +
        `See \`usesteady capabilities\` for the full per-op JSON schema.`);
}
function formatNonStringFieldMessage(opType, fieldName, actualType) {
    return (`op type "${opType}" requires field "${fieldName}" to be a string, ` +
        `but received ${actualType}. ` +
        `See \`usesteady capabilities\` for the full per-op JSON schema.`);
}
//# sourceMappingURL=json-to-ir.js.map