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
 *   - OPERATION_REGISTRY  (IR semantics/summary)
 *   - PUBLIC_JSON_SCHEMA (public-wire required/optional fields)
 *
 * This module adds presentation metadata only:
 *   - PUBLIC_JSON_EXAMPLES is the public --json wire shape per op, mirroring
 *     the HELP_TEXT "JSON op schema" block. The public JSON field names
 *     diverge from the IR field names for some ops (e.g. `create` uses
 *     JSON `file` but IR `path`); src/input/json-to-ir.ts owns that
 *     mapping. Required/optional fields describe the public wire so they
 *     agree with the examples the operator actually types.
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

import {
  ALL_OPERATION_TYPES,
  OPERATION_REGISTRY,
  type OperationType,
} from "../../input/op-registry.js";
import { PUBLIC_JSON_SCHEMA } from "../../input/public-json-schema.js";

/**
 * Public --json / batch wire-shape examples per op. Mirrors the HELP_TEXT
 * "JSON op schema" block in use-steady.ts. These are the field names the
 * operator actually types in --json or batch payloads.
 *
 * Frozen at module load. Mutation attempts fail loud in strict mode (which
 * the test runner uses) -- coverage of ALL_OPERATION_TYPES is asserted by
 * tests in tests/shell/capabilities.test.ts.
 */
const PUBLIC_JSON_EXAMPLES: Readonly<Record<OperationType, Readonly<Record<string, unknown>>>> =
  Object.freeze({
    create:     Object.freeze({ type: "create",     file: "path/to/file.ts" }),
    create_dir: Object.freeze({ type: "create_dir", path: "path/to/dir" }),
    delete:     Object.freeze({ type: "delete",     file: "path/to/file.ts" }),
    rename:     Object.freeze({ type: "rename",     from: "old.ts", to: "new.ts" }),
    // usesteady-public#45 / R-alpha-min publication truthfulness: the
    // example carries `occurrence: "first"` to mirror the OPERATION_REGISTRY
    // summary (`occurrence` is an accepted optional field but only "first"
    // passes the validate stage). Using "first" makes the example a working
    // invocation; "all" and { index: N } would be refused at runtime.
    replace:    Object.freeze({ type: "replace",    file: "src/Button.tsx", from: "old text", to: "new text", occurrence: "first" }),
    append:     Object.freeze({ type: "append",     file: "src/notes.md", to: "text to append" }),
    prepend:    Object.freeze({ type: "prepend",    file: "src/notes.md", to: "text to prepend" }),
    run:        Object.freeze({ type: "run",        to: "npm test" }),
  });

/**
 * Public catalog entry shape. Stable; this is the JSON output schema.
 */
export type CapabilityEntry = {
  readonly type: OperationType;
  /** Public wire field names (from PUBLIC_JSON_SCHEMA.required). */
  readonly required: readonly string[];
  /** Public wire field names (from PUBLIC_JSON_SCHEMA.optional). */
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
export function buildCapabilitiesCatalog(): CapabilitiesCatalog {
  const operations: CapabilityEntry[] = ALL_OPERATION_TYPES.map((t) => {
    const schema  = OPERATION_REGISTRY[t];
    const example = PUBLIC_JSON_EXAMPLES[t];
    const entry: CapabilityEntry = Object.freeze({
      type:        t,
      required:    PUBLIC_JSON_SCHEMA[t].required,
      optional:    PUBLIC_JSON_SCHEMA[t].optional,
      summary:     schema.summary,
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
export function renderCapabilitiesJson(): string {
  return JSON.stringify(buildCapabilitiesCatalog()) + "\n";
}

/**
 * Render the catalog as a human-readable text block. Bytes are identical
 * across runs for a given build.
 */
export function renderCapabilitiesText(): string {
  const catalog = buildCapabilitiesCatalog();
  const lines: string[] = [];
  lines.push("");
  lines.push("  UseSteady supported operations:");
  lines.push("");
  for (const entry of catalog.operations) {
    lines.push(`  ${entry.type}`);
    lines.push(`      ${entry.summary}`);
    lines.push(`      Required (JSON): ${entry.required.length > 0 ? entry.required.join(", ") : "(none)"}`);
    lines.push(`      Optional (JSON): ${entry.optional.length > 0 ? entry.optional.join(", ") : "(none)"}`);
    lines.push(`      JSON example:  ${JSON.stringify(entry.jsonExample)}`);
    lines.push("");
  }
  lines.push("  This catalog is read-only. It does not execute anything.");
  lines.push("  Field names above describe the public JSON input shown in each example.");
  lines.push("  For the full CLI usage, run: usesteady help");
  lines.push("");
  return lines.join("\n");
}
