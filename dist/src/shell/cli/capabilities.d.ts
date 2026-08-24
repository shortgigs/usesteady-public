/**
 * usesteady capabilities -- read-only catalog of supported IR operations.
 *
 * Pure module. No I/O, no process.exit, no execution. Importing this module
 * cannot read stdin, write the filesystem, spawn a process, or talk to a
 * model. It exists to render the operator-facing catalog of operations the
 * current build supports.
 *
 * Source of truth: src/input/op-registry.ts
 *   - ALL_OPERATION_TYPES (the closed set; coverage is enforced by tests)
 *   - OPERATION_REGISTRY  (per-op required/optional/summary)
 *
 * This module adds presentation metadata only:
 *   - PUBLIC_JSON_EXAMPLES is the public --json wire shape per op, mirroring
 *     the HELP_TEXT "JSON op schema" block. The public JSON field names
 *     diverge from the IR field names for some ops (e.g. `create` uses
 *     JSON `file` but IR `path`); src/input/json-to-ir.ts owns that
 *     mapping. The catalog surfaces both views so the operator sees what
 *     the registry says (IR canonical) and what they actually type (JSON
 *     public).
 *
 * Design: docs/product/useability-and-guided-execution-track.md §3.1.
 *
 * Determinism: every exported function is pure and order-stable.
 *   - operations are returned in ALL_OPERATION_TYPES order;
 *   - JSON output is single-line with stable key order
 *     (operations -> [{type, required, optional, summary, jsonExample}]);
 *   - text output bytes are identical across runs for a given build.
 *
 * Authority:
 *   - This module does not interact with the planner, the safety gate,
 *     the executor, the model-insertion path, or any approval surface.
 *   - The output is informational. Nothing in this catalog can be approved
 *     or executed. To actually run an operation, the operator authors a
 *     --json or batch payload and goes through the existing approval flow.
 */
import { type OperationType } from "../../input/op-registry.js";
/**
 * Public catalog entry shape. Stable; this is the JSON output schema.
 */
export type CapabilityEntry = {
    readonly type: OperationType;
    /** IR canonical field names (from OPERATION_REGISTRY.required). */
    readonly required: readonly string[];
    /** IR canonical field names (from OPERATION_REGISTRY.optional). */
    readonly optional: readonly string[];
    /** One-line human description (from OPERATION_REGISTRY.summary). */
    readonly summary: string;
    /** Public --json / batch wire-shape example. */
    readonly jsonExample: Readonly<Record<string, unknown>>;
};
/**
 * Top-level catalog shape. Stable; the JSON output is exactly this.
 */
export type CapabilitiesCatalog = {
    readonly operations: readonly CapabilityEntry[];
};
/**
 * Build the catalog. Pure. Deterministic. Operations are in
 * ALL_OPERATION_TYPES order (which is itself frozen).
 */
export declare function buildCapabilitiesCatalog(): CapabilitiesCatalog;
/**
 * Render the catalog as a single-line JSON string, terminated by exactly
 * one newline. Key order is fixed by the CapabilitiesCatalog +
 * CapabilityEntry shapes above, which are constructed in a fixed order in
 * buildCapabilitiesCatalog. JSON.stringify preserves insertion order for
 * string keys per the ECMAScript spec.
 */
export declare function renderCapabilitiesJson(): string;
/**
 * Render the catalog as a human-readable text block. Bytes are identical
 * across runs for a given build.
 */
export declare function renderCapabilitiesText(): string;
//# sourceMappingURL=capabilities.d.ts.map