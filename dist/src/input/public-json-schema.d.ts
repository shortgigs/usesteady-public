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
 *   - `create     { type, file }`            (IR uses `path`)
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
 * for each op. It is used solely for diagnostic enrichment when the JSON
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
 *     IR. This companion is consulted ONLY when those branches have
 *     already returned `null`, to produce a richer diagnostic message.
 *   - It does NOT introduce a new public `CliErrorCode`. The existing
 *     `invalid_op` code continues to be emitted for any malformed op. Only
 *     the human-readable stderr text is enriched.
 *   - It does NOT reject unknown extra fields. A JSON op carrying an
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
export declare const PUBLIC_JSON_SCHEMA: Readonly<Record<OperationType, PublicJsonOpSchema>>;
/**
 * Pure data accessor for the public-JSON schema. Mirrors
 * `getOperationSchema` in `op-registry.ts`. Never reads stdin, the
 * filesystem, or the network.
 */
export declare function getPublicJsonSchema(type: OperationType): PublicJsonOpSchema;
//# sourceMappingURL=public-json-schema.d.ts.map