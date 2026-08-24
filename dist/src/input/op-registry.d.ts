/**
 * OperationRegistry — single source of truth for the ops the CLI supports.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M1 SCOPE (load-bearing — review will reject any addition)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This module is the M1 milestone of the canonical input pipeline defined in
 * `docs/CLI_INPUT_NORMALIZATION_DESIGN.md` (epic shortgigs/usesteady-core#218).
 *
 * It introduces ONE thing: a frozen, enumerated catalogue of the operations
 * the CLI supports, with the per-op argument schema mandated by the IR
 * Operation shape in design §5.1.
 *
 * That is all. Everything else listed below is deferred:
 *
 *   - Feasibility checks (target_exists, file-not-found, binary refusal,
 *     symlink escape, etc.) — deferred to M3 (FeasibilityValidator).
 *   - NL grammar / pattern matching — deferred to M4 (InputNormalizer).
 *   - IR construction or normalize() function — deferred to M2 (IR for
 *     JSON + batch) and M4 (NL).
 *   - Session / stdin handling — deferred to M5 (SessionController).
 *   - Execution — already lives in the existing executor; not touched.
 *
 * No existing path is migrated to use this registry in M1. Per the M1
 * guardrails (CTO greenlight on PR #219):
 *
 *     "registry is introduced as infrastructure / existing paths may
 *      reference it, but must not be migrated wholesale yet"
 *
 * Three op enumerations exist today in divergent forms — see the audit in the
 * epic. They remain in place untouched. M2 begins the migration.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Why 8 ops (M2 gate resolved the create_dir question)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The registry mirrors the IR Operation shape in design note §5.1
 * (revision v2.1). At v2 the IR had 7 ops and `create_dir` was deferred to
 * M2; at v2.1 the M2 gate decided to add `create_dir` as a first-class IR
 * op rather than collapse it into a `kind` discriminator on `create`. The
 * audit found the UX does not treat files and directories as one concept
 * anywhere except in the draft-layer collapse bug that M4 removes — the NL
 * surface has distinct vocabulary (`mkdir`, `create folder`, `create
 * directory`, `scaffold dir`), the internal `ParsedIntent` discriminates
 * `kind: "create_dir"` vs `kind: "create_file"`, and the workflow task type
 * has distinct enum values. See design §5.1 footnote and §10 #7.
 *
 * The IR is a superset of every surface. The published `--json` / `batch`
 * user schema (documented in `usesteady --help`) still exposes only 7 ops
 * and does not include `create_dir`; the JSON adapter at M2 simply does not
 * emit `create_dir` (the schema does not let it). The 8th IR op is reachable
 * only from NL today, and M4 is the surface that wires it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Invariants (from design §4)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   - The registry is frozen at module load. It cannot be mutated at runtime.
 *   - The registry exposes data only. No function in this module reads stdin,
 *     touches the filesystem, or invokes the executor.
 *   - The registry shape is decoupled from the existing op enumerations on
 *     purpose. Aligning them is M2's job, not M1's.
 */
/**
 * The eight operation types the CLI supports, matching design note §5.1
 * (v2.1) IR Operation discriminated union. `create_dir` is distinct from
 * `create` per the M2 gate decision (§5.1 footnote / §10 #7).
 */
export type OperationType = "create" | "create_dir" | "delete" | "rename" | "replace" | "append" | "prepend" | "run";
/**
 * Per-operation argument schema. `required` and `optional` enumerate the arg
 * names mandated by the IR Operation shape in design §5.1; the actual TypeScript
 * arg types are NOT defined here — they are defined alongside the IR shape in
 * M2. Keeping arg types out of M1 prevents this module from coupling to a shape
 * that has not yet been built.
 *
 * `summary` is a one-line human description used downstream (help text, error
 * messages) when M3/M4 wire the registry into user-facing surfaces. It is data,
 * not a template — it does not interpolate user input.
 */
export type OperationSchema = {
    readonly type: OperationType;
    readonly required: readonly string[];
    readonly optional: readonly string[];
    readonly summary: string;
};
/**
 * The registry. Frozen on every level (the registry object, each schema, each
 * `required`/`optional` array). Mutation attempts in non-strict mode silently
 * fail; in strict mode (which our test runner uses) they throw — that
 * fail-loud behaviour is asserted by the contract tests.
 */
export declare const OPERATION_REGISTRY: Readonly<Record<OperationType, OperationSchema>>;
/**
 * Stable enumeration order for iteration. Frozen. Tests assert that the order
 * here matches the registry's keys.
 */
export declare const ALL_OPERATION_TYPES: readonly OperationType[];
/**
 * Look up a schema by operation type. Pure data accessor — no side effects,
 * no validation, no execution.
 */
export declare function getOperationSchema(type: OperationType): OperationSchema;
/**
 * Type guard for unknown values. Used by future milestones (M2 IR validation,
 * M4 NL normalizer) to safely classify candidate operation strings without
 * accepting unknown ops as valid.
 */
export declare function isKnownOperationType(value: unknown): value is OperationType;
/**
 * Returns the per-op summary strings in registry order. Provided for future
 * use by help text / error messages once M3/M4 wire the registry into
 * user-facing surfaces. M1 itself does not consume this; the function exists
 * so M2+ does not have to introduce it as a separate change.
 */
export declare function listOperationSummaries(): readonly string[];
//# sourceMappingURL=op-registry.d.ts.map