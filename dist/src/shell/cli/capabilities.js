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
import { ALL_OPERATION_TYPES, OPERATION_REGISTRY, } from "../../input/op-registry.js";
/**
 * Public --json / batch wire-shape examples per op. Mirrors the HELP_TEXT
 * "JSON op schema" block in use-steady.ts. These are the field names the
 * operator actually types in --json or batch payloads.
 *
 * Frozen at module load. Mutation attempts fail loud in strict mode (which
 * the test runner uses) -- coverage of ALL_OPERATION_TYPES is asserted by
 * tests in tests/shell/capabilities.test.ts.
 */
const PUBLIC_JSON_EXAMPLES = Object.freeze({
    create: Object.freeze({ type: "create", file: "path/to/file.ts" }),
    create_dir: Object.freeze({ type: "create_dir", path: "path/to/dir" }),
    delete: Object.freeze({ type: "delete", file: "path/to/file.ts" }),
    rename: Object.freeze({ type: "rename", from: "old.ts", to: "new.ts" }),
    // usesteady-public#45 / R-alpha-min publication truthfulness: the
    // example carries `occurrence: "first"` to mirror the OPERATION_REGISTRY
    // summary (`occurrence` is an accepted optional field but only "first"
    // passes the validate stage). Using "first" makes the example a working
    // invocation; "all" and { index: N } would be refused at runtime.
    replace: Object.freeze({ type: "replace", file: "src/Button.tsx", from: "old text", to: "new text", occurrence: "first" }),
    append: Object.freeze({ type: "append", file: "src/notes.md", to: "text to append" }),
    prepend: Object.freeze({ type: "prepend", file: "src/notes.md", to: "text to prepend" }),
    run: Object.freeze({ type: "run", to: "npm test" }),
});
/**
 * Build the catalog. Pure. Deterministic. Operations are in
 * ALL_OPERATION_TYPES order (which is itself frozen).
 */
export function buildCapabilitiesCatalog() {
    const operations = ALL_OPERATION_TYPES.map((t) => {
        const schema = OPERATION_REGISTRY[t];
        const example = PUBLIC_JSON_EXAMPLES[t];
        const entry = Object.freeze({
            type: t,
            required: schema.required,
            optional: schema.optional,
            summary: schema.summary,
            jsonExample: example,
        });
        return entry;
    });
    return Object.freeze({ operations: Object.freeze(operations) });
}
/**
 * Render the catalog as a single-line JSON string, terminated by exactly
 * one newline. Key order is fixed by the CapabilitiesCatalog +
 * CapabilityEntry shapes above, which are constructed in a fixed order in
 * buildCapabilitiesCatalog. JSON.stringify preserves insertion order for
 * string keys per the ECMAScript spec.
 */
export function renderCapabilitiesJson() {
    return JSON.stringify(buildCapabilitiesCatalog()) + "\n";
}
/**
 * Render the catalog as a human-readable text block. Bytes are identical
 * across runs for a given build.
 */
export function renderCapabilitiesText() {
    const catalog = buildCapabilitiesCatalog();
    const lines = [];
    lines.push("");
    lines.push("  UseSteady supported operations:");
    lines.push("");
    for (const entry of catalog.operations) {
        lines.push(`  ${entry.type}`);
        lines.push(`      ${entry.summary}`);
        lines.push(`      Required (IR): ${entry.required.length > 0 ? entry.required.join(", ") : "(none)"}`);
        lines.push(`      Optional (IR): ${entry.optional.length > 0 ? entry.optional.join(", ") : "(none)"}`);
        lines.push(`      JSON example:  ${JSON.stringify(entry.jsonExample)}`);
        lines.push("");
    }
    lines.push("  This catalog is read-only. It does not execute anything.");
    lines.push("  IR field names (above) may differ from public JSON field");
    lines.push("  names in the example -- the example is what you type.");
    lines.push("  For the full CLI usage, run: usesteady help");
    lines.push("");
    return lines.join("\n");
}
//# sourceMappingURL=capabilities.js.map