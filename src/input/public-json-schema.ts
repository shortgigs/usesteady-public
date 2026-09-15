/**
 * src/input/public-json-schema.ts
 *
 * Public --json / batch wire-shape companion to `op-registry.ts`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Why this companion exists (R-alpha-min, usesteady-public#45 follow-on)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `OPERATION_REGISTRY` (in `op-registry.ts`) records the IR-canonical argument
 * names for each op (`path`, `from`, `to`, `file`, `text`, `command`,
 * `occurrence`). Those names are correct for the IR layer and for the
 * `Operation` discriminated union in `ir.ts`.
 *
 * The public --json / batch wire shape DOES NOT use those same names for
 * several ops. The published surface that operators actually type uses:
 *
 *   - `create     { type, file, [contents] }` (IR uses `path`)
 *   - `delete     { type, file }`            (IR uses `path`)
 *   - `create_dir { type, path }`            (matches IR)
 *   - `rename     { type, from, to }`        (matches IR)
 *   - `replace    { type, file, from, to, [occurrence] }`  (matches IR; occurrence
 *                                                            optional per #45)
 *   - `append     { type, file, to }`        (IR uses `text` instead of `to`)
 *   - `prepend    { type, file, to }`        (IR uses `text` instead of `to`)
 *   - `run        { type, to }`              (IR uses `command` instead of `to`)
 *
 * The divergence is intentional: design note "§10 #7" documents that the
 * legacy DraftTask layer named several content-bearing fields `to`, and the
 * public schema kept that name on the wire to avoid breaking documented
 * fixtures. `json-to-ir.ts` is the single place that bridges the two name
 * spaces (see the `case` branches in `jsonOpToIROperation`).
 *
 * This companion declares the PUBLIC-WIRE field names and their requirement
 * for each op. It is used for capabilities and diagnostic enrichment when the JSON
 * adapter rejects an op: instead of the opaque "unknown or invalid
 * operation" message, the CLI can name the specific missing field using the
 * exact key the operator typed (e.g. "missing required field `file`").
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Authority boundary (load-bearing)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This companion is DESCRIPTIVE, not authoritative. Specifically:
 *
 *   - It does NOT replace `OPERATION_REGISTRY` as the IR-canonical schema.
 *   - It does NOT drive the accept/reject boundary in `json-to-ir.ts`. The
 *     per-case branches there continue to decide whether an op converts to
 *     IR. Diagnostic callers consult this companion after those branches
 *     return `null`; capabilities uses it to describe the accepted wire.
 *   - It does NOT introduce a new public `CliErrorCode`. The existing
 *     `invalid_op` code continues to be emitted for any malformed op. Only
 *     the human-readable stderr text is enriched.
 *   - It does NOT reject unrelated unknown extra fields. ADV-V2-037 rejects
 *     known create content/to aliases in the parser rather than losing bytes.
 *     Otherwise a JSON op carrying an
 *     unrecognized key continues to be accepted (the key is dropped by
 *     `strField`/the case branch). Tightening that surface would be a
 *     public-contract change and is deferred per the R-alpha-min brief.
 *   - It does NOT change `OPERATION_REGISTRY`. The registry remains the
 *     IR-canonical source of truth; this companion sits beside it.
 *
 * The frozen-at-load-time invariant matches `OPERATION_REGISTRY`. Mutation
 * attempts fail loud in strict mode (which the test runner uses).
 */

import type { OperationType } from "./op-registry.js";

/**
 * Public --json / batch wire-shape schema for a single op.
 *
 * `required` and `optional` enumerate PUBLIC-WIRE field names (the keys the
 * operator types in their JSON). They are intentionally separate from
 * `OPERATION_REGISTRY[t].required` / `.optional`, which carry IR-canonical
 * names. Tests pin both layers and assert their distinct purposes.
 */
export type PublicJsonOpSchema = {
  readonly type: OperationType;
  readonly required: readonly string[];
  readonly optional: readonly string[];
};

/**
 * The companion. Frozen on every level (the record, each schema, each
 * `required`/`optional` array). Contract tests assert frozenness.
 *
 * Order matches `ALL_OPERATION_TYPES` in `op-registry.ts` so any iteration
 * is deterministic.
 */
export const PUBLIC_JSON_SCHEMA: Readonly<Record<OperationType, PublicJsonOpSchema>> = Object.freeze({
  create: Object.freeze({
    type: "create",
    required: Object.freeze(["file"]) as readonly string[],
    optional: Object.freeze(["contents"]) as readonly string[],
  }),
  create_dir: Object.freeze({
    type: "create_dir",
    required: Object.freeze(["path"]) as readonly string[],
    optional: Object.freeze([]) as readonly string[],
  }),
  delete: Object.freeze({
    type: "delete",
    required: Object.freeze(["file"]) as readonly string[],
    optional: Object.freeze([]) as readonly string[],
  }),
  rename: Object.freeze({
    type: "rename",
    required: Object.freeze(["from", "to"]) as readonly string[],
    optional: Object.freeze([]) as readonly string[],
  }),
  replace: Object.freeze({
    type: "replace",
    required: Object.freeze(["file", "from", "to"]) as readonly string[],
    // usesteady-public#45 — `occurrence` is accepted on the public wire
    // (the adapter parses it and populates IR `requestedOccurrence`) but
    // only "first" passes the validate stage today. "all" and { index: N }
    // are refused with `ambiguous_match`. The capabilities summary in
    // `op-registry.ts` documents this; the field appears here so missing-
    // field diagnostics know not to call it "missing" when absent.
    optional: Object.freeze(["occurrence"]) as readonly string[],
  }),
  append: Object.freeze({
    type: "append",
    // Public wire uses `to` for the text payload (legacy DraftTask field
    // name preserved per design §10 #7). IR uses `text`.
    required: Object.freeze(["file", "to"]) as readonly string[],
    optional: Object.freeze([]) as readonly string[],
  }),
  prepend: Object.freeze({
    type: "prepend",
    required: Object.freeze(["file", "to"]) as readonly string[],
    optional: Object.freeze([]) as readonly string[],
  }),
  run: Object.freeze({
    type: "run",
    // Public wire uses `to` for the shell command (legacy DraftTask field
    // name preserved). IR uses `command`.
    required: Object.freeze(["to"]) as readonly string[],
    optional: Object.freeze([]) as readonly string[],
  }),
});

/**
 * Pure data accessor for the public-JSON schema. Mirrors
 * `getOperationSchema` in `op-registry.ts`. Never reads stdin, the
 * filesystem, or the network.
 */
export function getPublicJsonSchema(type: OperationType): PublicJsonOpSchema {
  return PUBLIC_JSON_SCHEMA[type];
}
