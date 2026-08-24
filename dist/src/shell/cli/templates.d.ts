/**
 * usesteady templates -- read-only catalog of safe starter workflows.
 *
 * Pure module. No I/O, no process.exit, no execution. Importing this module
 * cannot read stdin, write the filesystem, spawn a process, or talk to a
 * model. It exists to render operator-facing example workflows that the
 * operator can copy, customize, and run through the existing approval flow.
 *
 * Source of truth: every operation referenced in every template MUST be a
 * member of ALL_OPERATION_TYPES (src/input/op-registry.ts). Tests assert
 * this. There is no second op list to drift against.
 *
 * Wire shape: each operation in a template matches the same public JSON
 * shape exposed by `usesteady capabilities` (src/shell/cli/capabilities.ts
 * PUBLIC_JSON_EXAMPLES). The operator can take the printed JSON, replace
 * the placeholder values, and run it through `usesteady --json '...' --yes`
 * (single op) or via a batch file (`usesteady batch <file> --yes`).
 *
 * Authority:
 *   - This module does not interact with the planner, the safety gate, the
 *     executor, the model-insertion path, or any approval surface.
 *   - The output is informational. Printing a template does NOT approve or
 *     execute anything. To actually run a customized template the operator
 *     must invoke a separate `usesteady run` / `--json` / `batch` command
 *     which then goes through the standard approval flow.
 *   - Templates contain placeholder values only (e.g. "path/to/file.ts").
 *     No template targets a real file in the operator's workspace.
 *
 * Determinism: every exported function is pure and order-stable.
 *   - templates are returned in TEMPLATE_NAMES order (frozen);
 *   - JSON output is single-line with stable key order;
 *   - text output bytes are identical across runs for a given build.
 *
 * Design: docs/product/useability-and-guided-execution-track.md section 3.2.
 */
import { type OperationType } from "../../input/op-registry.js";
/**
 * Stable identifiers for templates. Frozen. Tests assert that every name
 * here has a matching entry in TEMPLATE_REGISTRY and vice versa.
 */
export declare const TEMPLATE_NAMES: readonly ["append-to-file", "safe-rename", "multi-file-replace", "non-destructive-cleanup", "git-safe-review-flow", "bump-version", "add-import", "safe-env-update"];
export type TemplateName = typeof TEMPLATE_NAMES[number];
/**
 * Public template entry shape. Stable; this is the JSON output schema for
 * `usesteady templates <name> --output json`.
 *
 *   - `name`            : kebab-case identifier (stable across versions).
 *   - `purpose`         : one-sentence description of what the template does.
 *   - `requiredFields`  : placeholder field names the operator MUST replace.
 *   - `optionalFields`  : placeholder field names the operator MAY replace.
 *   - `exampleValues`   : ordered (key, description) pairs documenting what
 *                         realistic values look like for each placeholder.
 *   - `safetyNotes`     : short bullet list of what to verify before running.
 *   - `operations`      : array of public-JSON-shape operation objects with
 *                         placeholder values. Operator copies, customizes,
 *                         and runs through the standard approval flow.
 */
export type TemplateEntry = {
    readonly name: TemplateName;
    readonly purpose: string;
    readonly requiredFields: readonly string[];
    readonly optionalFields: readonly string[];
    readonly exampleValues: readonly {
        readonly field: string;
        readonly example: string;
    }[];
    readonly safetyNotes: readonly string[];
    readonly operations: readonly Readonly<Record<string, unknown>>[];
};
/**
 * Top-level catalog shape. Stable; the JSON output of
 * `usesteady templates --output json` is exactly this.
 */
export type TemplatesCatalog = {
    readonly templates: readonly {
        readonly name: TemplateName;
        readonly purpose: string;
    }[];
};
/**
 * Look up a template by name. Pure data accessor. Returns undefined for
 * unknown names -- callers decide how to surface that (exit code, error
 * message, etc.).
 */
export declare function getTemplate(name: string): TemplateEntry | undefined;
/**
 * Type guard for unknown values. Used by the CLI dispatcher to decide
 * whether `usesteady templates <name>` should print a template or report
 * an unknown-template error.
 */
export declare function isKnownTemplateName(value: unknown): value is TemplateName;
/**
 * Build the top-level catalog. Pure. Deterministic. Templates are returned
 * in TEMPLATE_NAMES order (which is itself frozen).
 */
export declare function buildTemplatesCatalog(): TemplatesCatalog;
/**
 * Internal helper: assert every operation in every template uses a known
 * operation type. Exported for the test suite -- the assertion runs at test
 * time so a future template addition that introduces a typo or an unknown
 * op type fails CI rather than shipping broken JSON wire shapes.
 */
export declare function getAllTemplateOperationTypes(): readonly string[];
/**
 * Returns true if every operation in every template uses an operation type
 * present in ALL_OPERATION_TYPES. Pure. Tests assert this.
 */
export declare function allTemplateOperationsUseRegisteredOps(): boolean;
/**
 * Render the top-level catalog as a single-line JSON string terminated by
 * exactly one newline. Determinism: JSON.stringify preserves insertion
 * order for string keys per the ECMAScript spec.
 */
export declare function renderTemplatesListJson(): string;
/**
 * Render the top-level catalog as a human-readable text block. Bytes are
 * identical across runs for a given build.
 */
export declare function renderTemplatesListText(): string;
/**
 * Render one template as JSON. Returns undefined for unknown names so the
 * caller can decide the exit-code policy.
 */
export declare function renderTemplateDetailJson(name: string): string | undefined;
/**
 * Render one template as a human-readable text block. Returns undefined
 * for unknown names so the caller can decide the exit-code policy.
 */
export declare function renderTemplateDetailText(name: string): string | undefined;
/**
 * Render an unknown-template error as a text block. Centralized so the CLI
 * dispatcher and tests see the same wording.
 */
export declare function renderUnknownTemplateText(name: string): string;
/**
 * Re-export OperationType to keep callers that need to inspect template
 * operations from having to import op-registry separately. Read-only --
 * the registry itself is in op-registry.ts and is the single source of
 * truth.
 */
export type { OperationType };
//# sourceMappingURL=templates.d.ts.map