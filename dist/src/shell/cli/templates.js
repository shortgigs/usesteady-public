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
import { ALL_OPERATION_TYPES, } from "../../input/op-registry.js";
/**
 * Stable identifiers for templates. Frozen. Tests assert that every name
 * here has a matching entry in TEMPLATE_REGISTRY and vice versa.
 */
export const TEMPLATE_NAMES = Object.freeze([
    "append-to-file",
    "safe-rename",
    "multi-file-replace",
    "non-destructive-cleanup",
    "git-safe-review-flow",
    // alpha.58 ergonomics: domain-specific recipes that reduce
    // "how do I safely do X?" authoring trial-and-error. Each recipe
    // reuses the existing template architecture and existing operation
    // types -- no new operations, no template engine, no parameter DSL.
    "bump-version",
    "add-import",
    "safe-env-update",
]);
/**
 * The registry. Frozen on every level (registry object, each entry, each
 * array, each operation). Mutation attempts in strict mode (which the test
 * runner uses) throw -- coverage is asserted by tests.
 *
 * Every operation type referenced below is a member of ALL_OPERATION_TYPES.
 * No template uses `delete` or `run` -- starter templates are deliberately
 * non-destructive and do not invoke commands. An operator who wants delete
 * or run can author a custom workflow; the templates surface stays safe.
 */
const TEMPLATE_REGISTRY = Object.freeze({
    "append-to-file": Object.freeze({
        name: "append-to-file",
        purpose: "Append a block of text to an existing file without touching anything that is already there.",
        requiredFields: Object.freeze(["file", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "file", example: "NOTES.md" }),
            Object.freeze({ field: "to", example: "hello from usesteady" }),
        ]),
        safetyNotes: Object.freeze([
            "Append never overwrites existing content; the file's prior bytes remain.",
            "If the target file does not exist, it will be created (append acts like `>>` -- it never errors on a missing file).",
            "Double-check the target path before approving so you do not create a new file by accident.",
            "JSON strings: use \\n inside the JSON to encode a newline character in the appended text.",
        ]),
        operations: Object.freeze([
            Object.freeze({
                type: "append",
                file: "NOTES.md",
                to: "hello from usesteady",
            }),
        ]),
    }),
    "safe-rename": Object.freeze({
        name: "safe-rename",
        purpose: "Rename a single file with explicit approval. Atomic at the filesystem level; reversible by a reverse rename.",
        requiredFields: Object.freeze(["from", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "from", example: "src/utils/old-name.ts" }),
            Object.freeze({ field: "to", example: "src/utils/new-name.ts" }),
        ]),
        safetyNotes: Object.freeze([
            "Imports of the renamed file in other files are NOT auto-updated; review them separately.",
            "Verify there is no existing file at the destination path before approving.",
            "Reversible by a second rename with `from` and `to` swapped.",
        ]),
        operations: Object.freeze([
            Object.freeze({
                type: "rename",
                from: "src/utils/old-name.ts",
                to: "src/utils/new-name.ts",
            }),
        ]),
    }),
    "multi-file-replace": Object.freeze({
        name: "multi-file-replace",
        purpose: "Apply the same exact-text replacement across an explicit, hand-listed set of files. Each operation is approved individually.",
        requiredFields: Object.freeze(["file", "from", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "file", example: "src/Header.tsx (one entry per target file)" }),
            Object.freeze({ field: "from", example: "OldBrand" }),
            Object.freeze({ field: "to", example: "NewBrand" }),
        ]),
        safetyNotes: Object.freeze([
            "Each `from` should be a unique, exact string in the target file; ambiguous matches are refused.",
            "Files are processed in the order listed; each gets its own approval prompt.",
            "Restrict the list to files you have explicitly enumerated -- no glob expansion.",
            "Preview every diff individually; do not bulk-approve a list you have not read.",
        ]),
        operations: Object.freeze([
            Object.freeze({ type: "replace", file: "src/Header.tsx", from: "OldBrand", to: "NewBrand" }),
            Object.freeze({ type: "replace", file: "src/Footer.tsx", from: "OldBrand", to: "NewBrand" }),
            Object.freeze({ type: "replace", file: "README.md", from: "OldBrand", to: "NewBrand" }),
        ]),
    }),
    "non-destructive-cleanup": Object.freeze({
        name: "non-destructive-cleanup",
        purpose: "Organize existing files into a new directory by renaming them. Creates the directory first; moves files via rename. No deletions.",
        requiredFields: Object.freeze(["path", "from", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "path", example: "docs/archive (new directory)" }),
            Object.freeze({ field: "from", example: "docs/old-design.md (current location)" }),
            Object.freeze({ field: "to", example: "docs/archive/old-design.md (new location)" }),
        ]),
        safetyNotes: Object.freeze([
            "No file is deleted; renames are reversible by reverse-rename.",
            "Create the destination directory first; rename ops fail if the directory does not exist.",
            "Imports / cross-references to the moved files are NOT auto-updated; review them separately.",
            "Approve each rename individually; do not assume the list is complete.",
        ]),
        operations: Object.freeze([
            Object.freeze({ type: "create_dir", path: "docs/archive" }),
            Object.freeze({ type: "rename", from: "docs/old-design.md", to: "docs/archive/old-design.md" }),
            Object.freeze({ type: "rename", from: "docs/superseded-spec.md", to: "docs/archive/superseded-spec.md" }),
        ]),
    }),
    "git-safe-review-flow": Object.freeze({
        name: "git-safe-review-flow",
        purpose: "Capture review notes in a tracked file (REVIEW.md) without modifying any source code. Creates the file if missing; appends additional notes on subsequent runs.",
        requiredFields: Object.freeze(["file", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "file", example: "REVIEW.md" }),
            Object.freeze({ field: "to", example: "Review note: looks good overall." }),
        ]),
        safetyNotes: Object.freeze([
            "Only touches a single review notes file; never modifies source code.",
            "Use `create` for the first run (writes file); use `append` for subsequent runs (adds to it).",
            "Commit and review the diff before merging -- the file should be small and human-readable.",
            "Switch to `append` once the file exists; `create` on an existing file is refused (error: `target_exists`) so the existing file is never overwritten.",
        ]),
        operations: Object.freeze([
            Object.freeze({ type: "create", file: "REVIEW.md" }),
            Object.freeze({
                type: "append",
                file: "REVIEW.md",
                to: "Review note: looks good overall.",
            }),
        ]),
    }),
    // ─── alpha.58 ergonomics: domain-specific recipes ─────────────────────
    //
    // Each recipe below is intentionally small (1-2 ops) and uses only the
    // existing operation types. Wording in `safetyNotes` matches runtime
    // behavior verified against `src/cursor/adapters/inprocess-adapter.ts`
    // (see the runtime-truthfulness regression tests in
    // `tests/shell/templates.test.ts`).
    "bump-version": Object.freeze({
        name: "bump-version",
        purpose: "Bump a project version: replace the `\"version\"` field in package.json and append a matching CHANGELOG.md entry. Two operations across two files; does NOT run git, npm, or any command.",
        requiredFields: Object.freeze(["file", "from", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "file (op 1)", example: "package.json" }),
            Object.freeze({ field: "from (op 1)", example: "\"version\": \"0.1.0\"  (exact existing line; quote style and spacing must match)" }),
            Object.freeze({ field: "to   (op 1)", example: "\"version\": \"0.1.1\"  (new line with the same surrounding format)" }),
            Object.freeze({ field: "file (op 2)", example: "CHANGELOG.md" }),
            Object.freeze({ field: "to   (op 2)", example: "\\n## 0.1.1\\n\\n- summary of changes\\n  (use \\n for real newlines)" }),
        ]),
        safetyNotes: Object.freeze([
            "The `replace` op needs the exact existing version line as `from`; differences in whitespace, quote style, or trailing comma will refuse with `old_value_not_found`.",
            "If the same `\"version\": \"x.y.z\"` string appears elsewhere (rare in package.json; possible in lock-step monorepos), `replace` refuses with `ambiguous_match`. Add an occurrence index or use a stricter `from` to disambiguate.",
            "The CHANGELOG `append` adds to the END of the file. If you keep newest entries at the top, switch the second op's type from `append` to `prepend`.",
            "If CHANGELOG.md does not exist it will be created (append creates if missing). Double-check the path so you do not create a CHANGELOG in the wrong directory.",
            "If package.json does not exist, `replace` refuses with `file_not_found` -- it does NOT create the file (only append/prepend/create do).",
            "This recipe does NOT run `git`, `git tag`, `git commit`, `npm version`, `npm publish`, or any shell command. The operator runs those separately.",
            "Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) are NOT auto-updated; refresh them with your package manager after approval.",
        ]),
        operations: Object.freeze([
            Object.freeze({
                type: "replace",
                file: "package.json",
                from: "\"version\": \"0.1.0\"",
                to: "\"version\": \"0.1.1\"",
            }),
            Object.freeze({
                type: "append",
                file: "CHANGELOG.md",
                to: "\n## 0.1.1\n\n- summary of changes\n",
            }),
        ]),
    }),
    "add-import": Object.freeze({
        name: "add-import",
        purpose: "Prepend an import statement to the top of a source file. Single operation using `prepend`, which writes to the very start of the file.",
        requiredFields: Object.freeze(["file", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "file", example: "src/utils/format.ts" }),
            Object.freeze({ field: "to", example: "import { z } from \"zod\";\\n  (terminate with \\n so the import lands on its own line)" }),
        ]),
        safetyNotes: Object.freeze([
            "`prepend` writes to the very start of the file. If the file has a license header, shebang, or `\"use strict\";`, the import lands BEFORE it -- which is usually not what you want.",
            "For files where you need to preserve a header, use `replace` against an existing line near the imports instead; the `multi-file-replace` template shows the shape.",
            "This recipe does NOT sort, group, or de-duplicate imports. If the same import already exists in the file, you will end up with two copies.",
            "Always terminate the `to` value with `\\n` in the JSON so a real newline lands in the file; otherwise the import is glued to whatever was previously on line 1.",
            "If the target file does not exist, `prepend` creates it (same create-if-missing behavior as `append`). Double-check the path so you do not create a stub file by accident.",
        ]),
        operations: Object.freeze([
            Object.freeze({
                type: "prepend",
                file: "src/utils/format.ts",
                to: "import { z } from \"zod\";\n",
            }),
        ]),
    }),
    "safe-env-update": Object.freeze({
        name: "safe-env-update",
        purpose: "Wire-shape and review-pattern reference for `KEY=value` line edits in dotenv-style files via exact-text `replace`. The `.env.local` example is illustrative only -- UseSteady's safety detector refuses any input mentioning `.env` at the safety gate before approval (by design); adapt the path to a non-dotenv config file to run a customized version, or edit `.env*` files directly with your editor.",
        requiredFields: Object.freeze(["file", "from", "to"]),
        optionalFields: Object.freeze([]),
        exampleValues: Object.freeze([
            Object.freeze({ field: "file", example: ".env.local  (illustrative; refused by the safety detector before approval -- see safety notes)" }),
            Object.freeze({ field: "from", example: "API_URL=http://localhost:3000  (exact existing line; no surrounding whitespace, no quotes unless they are in the file)" }),
            Object.freeze({ field: "to", example: "API_URL=https://api.example.com" }),
        ]),
        safetyNotes: Object.freeze([
            "UseSteady's safety detector refuses any input containing `.env` (case-insensitive, word boundary) at the safety gate, which runs BEFORE the SYSTEM WILL approval preview. This recipe's `.env.local` example will be refused with reason `credential_or_secret_access` (matched pattern `.env`) and never reaches approval. The recipe documents the wire shape and review pattern, not a directly executable `.env.local` workflow. To run a customized version, target a non-dotenv config file (e.g. `services/app.config`), or edit `.env*` files directly with your editor.",
            "`replace` requires the exact existing line as `from`. Quoting style (`API_URL=\"...\"` vs `API_URL=...`), trailing whitespace, and inline comments (`# default`) all change the match.",
            "If two lines share the same exact text (e.g. two unset `KEY=` lines), `replace` refuses with `ambiguous_match`. Add an occurrence index to pick one.",
            "Dotenv files often hold secrets. Verify the new value before approving; the SYSTEM WILL preview shows the exact bytes that will be written.",
            "If the file is gitignored, the change will not show up in `git diff`. Keep a separate non-secret `.env.example` for tracked reference values.",
            "If the target file does not exist, `replace` refuses with `file_not_found` -- this recipe does NOT auto-create dotenv files (unlike `append` / `prepend`).",
            "Comments (`# ...`) and blank lines are unchanged. Only the line that exactly matches `from` is touched.",
        ]),
        operations: Object.freeze([
            Object.freeze({
                type: "replace",
                file: ".env.local",
                from: "API_URL=http://localhost:3000",
                to: "API_URL=https://api.example.com",
            }),
        ]),
    }),
});
/**
 * Look up a template by name. Pure data accessor. Returns undefined for
 * unknown names -- callers decide how to surface that (exit code, error
 * message, etc.).
 */
export function getTemplate(name) {
    if (!isKnownTemplateName(name))
        return undefined;
    return TEMPLATE_REGISTRY[name];
}
/**
 * Type guard for unknown values. Used by the CLI dispatcher to decide
 * whether `usesteady templates <name>` should print a template or report
 * an unknown-template error.
 */
export function isKnownTemplateName(value) {
    return typeof value === "string"
        && TEMPLATE_NAMES.includes(value);
}
/**
 * Build the top-level catalog. Pure. Deterministic. Templates are returned
 * in TEMPLATE_NAMES order (which is itself frozen).
 */
export function buildTemplatesCatalog() {
    const templates = TEMPLATE_NAMES.map((n) => Object.freeze({
        name: n,
        purpose: TEMPLATE_REGISTRY[n].purpose,
    }));
    return Object.freeze({ templates: Object.freeze(templates) });
}
/**
 * Internal helper: assert every operation in every template uses a known
 * operation type. Exported for the test suite -- the assertion runs at test
 * time so a future template addition that introduces a typo or an unknown
 * op type fails CI rather than shipping broken JSON wire shapes.
 */
export function getAllTemplateOperationTypes() {
    const types = [];
    for (const n of TEMPLATE_NAMES) {
        for (const op of TEMPLATE_REGISTRY[n].operations) {
            const t = op["type"];
            if (typeof t === "string")
                types.push(t);
        }
    }
    return Object.freeze(types);
}
/**
 * Returns true if every operation in every template uses an operation type
 * present in ALL_OPERATION_TYPES. Pure. Tests assert this.
 */
export function allTemplateOperationsUseRegisteredOps() {
    const known = new Set(ALL_OPERATION_TYPES);
    for (const t of getAllTemplateOperationTypes()) {
        if (!known.has(t))
            return false;
    }
    return true;
}
/**
 * Render the top-level catalog as a single-line JSON string terminated by
 * exactly one newline. Determinism: JSON.stringify preserves insertion
 * order for string keys per the ECMAScript spec.
 */
export function renderTemplatesListJson() {
    return JSON.stringify(buildTemplatesCatalog()) + "\n";
}
/**
 * Render the top-level catalog as a human-readable text block. Bytes are
 * identical across runs for a given build.
 */
export function renderTemplatesListText() {
    const catalog = buildTemplatesCatalog();
    const lines = [];
    lines.push("");
    lines.push("  UseSteady starter templates:");
    lines.push("");
    for (const entry of catalog.templates) {
        lines.push(`  ${entry.name}`);
        lines.push(`      ${entry.purpose}`);
        lines.push("");
    }
    lines.push("  Print a specific template with:");
    lines.push("      usesteady templates <name>");
    lines.push("      usesteady templates <name> --output json");
    lines.push("");
    lines.push("  Templates are read-only examples. Printing one does not");
    lines.push("  execute or approve anything. To run a customized template:");
    lines.push("");
    lines.push("      1. Copy the JSON operations from the template.");
    lines.push("      2. Replace the placeholder values with your real values.");
    lines.push("      3. Save as a batch file (e.g. ops.json).");
    lines.push("      4. Run:  usesteady batch ops.json");
    lines.push("         (add --yes only when you have reviewed the spec)");
    lines.push("");
    return lines.join("\n");
}
/**
 * Render one template as JSON. Returns undefined for unknown names so the
 * caller can decide the exit-code policy.
 */
export function renderTemplateDetailJson(name) {
    const entry = getTemplate(name);
    if (entry === undefined)
        return undefined;
    return JSON.stringify(entry) + "\n";
}
/**
 * Render one template as a human-readable text block. Returns undefined
 * for unknown names so the caller can decide the exit-code policy.
 */
export function renderTemplateDetailText(name) {
    const entry = getTemplate(name);
    if (entry === undefined)
        return undefined;
    const lines = [];
    lines.push("");
    lines.push(`  Template: ${entry.name}`);
    lines.push("");
    lines.push("  Purpose:");
    lines.push(`      ${entry.purpose}`);
    lines.push("");
    lines.push("  Required fields:");
    if (entry.requiredFields.length > 0) {
        for (const f of entry.requiredFields)
            lines.push(`      - ${f}`);
    }
    else {
        lines.push("      (none)");
    }
    lines.push("");
    lines.push("  Optional fields:");
    if (entry.optionalFields.length > 0) {
        for (const f of entry.optionalFields)
            lines.push(`      - ${f}`);
    }
    else {
        lines.push("      (none)");
    }
    lines.push("");
    lines.push("  Example values:");
    for (const ev of entry.exampleValues) {
        lines.push(`      ${ev.field}: ${ev.example}`);
    }
    lines.push("");
    lines.push("  Safety notes:");
    for (const note of entry.safetyNotes) {
        lines.push(`      - ${note}`);
    }
    lines.push("");
    lines.push("  Example operations (public JSON wire shape):");
    for (const op of entry.operations) {
        lines.push(`      ${JSON.stringify(op)}`);
    }
    lines.push("");
    lines.push("  To run a customized version:");
    lines.push("      1. Copy the operations above into a file (e.g. ops.json) as a JSON array.");
    lines.push("      2. Replace placeholder values with your real values.");
    lines.push("      3. Run:  usesteady batch ops.json");
    lines.push("         (add --yes only when you have reviewed the spec)");
    lines.push("");
    lines.push("  This template is read-only. Printing it does not execute anything.");
    lines.push("");
    return lines.join("\n");
}
/**
 * Render an unknown-template error as a text block. Centralized so the CLI
 * dispatcher and tests see the same wording.
 */
export function renderUnknownTemplateText(name) {
    const known = TEMPLATE_NAMES.join(", ");
    return (`\n  Error: unknown template "${name}"\n` +
        `  Known templates: ${known}\n` +
        `  List all templates with: usesteady templates\n\n`);
}
//# sourceMappingURL=templates.js.map