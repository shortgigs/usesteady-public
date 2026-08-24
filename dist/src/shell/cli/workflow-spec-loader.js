/**
 * src/shell/cli/workflow-spec-loader.ts
 *
 * Pure loader for `WorkflowSpec` JSON files.
 *
 * Extracted from `src/shell/cli/main.ts` (Stabilization P0 / PR-5 +
 * PR-K3 + S3/#40 + S4/#44) so it can be imported by code paths that
 * must NOT trigger main.ts's top-level `main()` invocation (which
 * starts the interactive CLI). Today that means:
 *
 *   - `src/shell/cli/workflow-inspect.ts` (P7-min Workflow Inspect).
 *
 * The loader's behavior is preserved verbatim:
 *
 *   - Reads `filePath` as UTF-8.
 *   - Resolves to absolute via `path.resolve` for diagnostic clarity.
 *   - Auto-wraps `--json` / `batch` shapes (single op object,
 *     non-empty op array) into a synthetic `WorkflowSpec` so the same
 *     three shapes accepted by `--json` / `batch` are also accepted
 *     by `run <spec.json>`.
 *   - Runs the rigid WorkflowSpec validators (name string, non-empty
 *     tasks array, per-task structural checks).
 *   - Synthesizes structured fields from NL when a task has only an
 *     `input` string (S4 / #44).
 *   - Throws `WorkflowSpecLoadError` with a canonical code on every
 *     pre-loop failure path: `file_not_found`, `invalid_json`, or
 *     `invalid_op` (the latter for both shape mismatches and NL-
 *     synth failures).
 *
 * Authority discipline: this module is pure (modulo `fs.readFileSync`).
 * Importing it produces no banners, no readline interfaces, no PostHog
 * captures, no I/O outside the explicit `loadWorkflowSpecFromFile`
 * call.
 */
import * as fs from "node:fs";
import { resolve as resolvePath } from "node:path";
import { jsonOpToIROperation } from "../../input/json-to-ir.js";
import { buildSpecTasksFromIROps } from "./spec-task-builder.js";
import { isNlRecoveryEligibleFailure, synthesizeStructuredFieldsFromNL, } from "./spec-nl-synth.js";
// ─── Error class ─────────────────────────────────────────────────────────────
/**
 * WorkflowSpecLoadError — typed error with a canonical code attached.
 *
 * The CLI's final-path error handler maps pre-workflow spec-load
 * failures to a canonical error code for the `--output json` result-
 * file without re-parsing the error message. Message strings are
 * single-sentence and never include the raw Node error text (e.g.
 * `ENOENT: no such file or directory, open '...'`), which previously
 * duplicated the absolute path on stdout.
 */
export class WorkflowSpecLoadError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "WorkflowSpecLoadError";
        this.code = code;
    }
}
// ─── S3 / friction #40 — Auto-wrap helpers ───────────────────────────────────
function looksLikeJsonOp(raw) {
    return (typeof raw === "object" &&
        raw !== null &&
        !Array.isArray(raw) &&
        typeof raw["type"] === "string");
}
function looksLikeJsonOpArray(raw) {
    return Array.isArray(raw) && raw.length > 0 && raw.every(looksLikeJsonOp);
}
function tryAutoWrapJsonOpsAsWorkflowSpec(raw) {
    let ops;
    if (looksLikeJsonOp(raw)) {
        ops = [raw];
    }
    else if (looksLikeJsonOpArray(raw)) {
        ops = raw;
    }
    else {
        return null;
    }
    const irOps = ops.map((op, i) => {
        const irOp = jsonOpToIROperation(op);
        if (irOp === null) {
            throw new WorkflowSpecLoadError("invalid_op", ops.length === 1
                ? `Workflow spec uses the JSON op shape but the op is unknown or malformed: ${JSON.stringify(op)}`
                : `Workflow spec uses the JSON op-array shape but element ${i + 1} is unknown or malformed: ${JSON.stringify(op)}`);
        }
        return irOp;
    });
    const specTasks = buildSpecTasksFromIROps(irOps);
    return {
        name: `Run spec: ${ops.length} operation(s)`,
        tasks: specTasks,
        defaultRuntime: "cursor",
    };
}
// ─── Accepted-shapes diagnostic ──────────────────────────────────────────────
const CONFLICTING_INPUT_SOURCES_MESSAGE = "Workflow task cannot define both input and structuredReplace. Use exactly one source of truth.";
function canonicalInputFromStructuredReplace(sr) {
    return `replace ${JSON.stringify(sr.oldValue)} with ${JSON.stringify(sr.newValue)} in ${sr.filePath}`;
}
const RUN_SPEC_ACCEPTED_SHAPES_MESSAGE = 'Workflow spec was not recognized.\n' +
    '  Accepted shapes:\n' +
    '    1. WorkflowSpec — { "name": "<workflow>", "tasks": [{ "input": "<NL>", ... }, ...] }\n' +
    '    2. JSON op      — { "type": "<op>", ... }                          (auto-wrapped, same shape as --json)\n' +
    '    3. JSON op array — [ { "type": "<op>", ... }, ... ]                (auto-wrapped, same shape as batch)\n' +
    '  Command form per shape:\n' +
    '    - WorkflowSpec object  →  usesteady run <file>\n' +
    '    - JSON op array        →  usesteady batch <file>  (or auto-wrapped via run <file>)\n' +
    '    - Single JSON op       →  usesteady --json \'<op>\' --yes  (or auto-wrapped via run <file>)\n' +
    '  See `usesteady examples` for minimal copyable JSON per shape,\n' +
    '  `usesteady capabilities` for the per-op field schema, and\n' +
    '  `usesteady --help` for the full CLI usage.';
// ─── Loader ──────────────────────────────────────────────────────────────────
/**
 * Load a WorkflowSpec from a JSON file. Validates required fields;
 * throws `WorkflowSpecLoadError` with a clear message on malformed
 * input.
 *
 * S3 / friction #40: also accepts the `--json` / `batch` JSON op
 * shapes. If the parsed JSON is a single op object or an op array,
 * it is auto-wrapped into a synthetic `WorkflowSpec` with
 * `name: "Run spec: N operation(s)"` and tasks built via the same
 * IR pipeline `processJsonInput` uses. Strict `WorkflowSpec` shapes
 * continue to load unchanged.
 *
 * S4 / friction #44: tasks that carry only an `input` string have
 * their structured fields synthesized via `synthesizeStructuredFields
 * FromNL`, so the coordinator never has to fall back to a separate
 * NL parser.
 */
export function loadWorkflowSpecFromFile(filePath) {
    const absolutePath = resolvePath(filePath);
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch (cause) {
        const nodeCode = cause?.code;
        if (nodeCode === "ENOENT") {
            throw new WorkflowSpecLoadError("file_not_found", `Workflow spec not found: ${absolutePath}`);
        }
        if (nodeCode === "EACCES" || nodeCode === "EPERM") {
            throw new WorkflowSpecLoadError("file_not_found", `Workflow spec not readable (permission denied): ${absolutePath}`);
        }
        if (cause instanceof SyntaxError) {
            throw new WorkflowSpecLoadError("invalid_json", `Workflow spec is not valid JSON: ${absolutePath}`);
        }
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new WorkflowSpecLoadError("invalid_op", `Could not read workflow spec at ${absolutePath}: ${reason}`);
    }
    const autoWrapped = tryAutoWrapJsonOpsAsWorkflowSpec(raw);
    if (autoWrapped !== null) {
        return autoWrapped;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new WorkflowSpecLoadError("invalid_op", RUN_SPEC_ACCEPTED_SHAPES_MESSAGE);
    }
    const obj = raw;
    if (typeof obj["name"] !== "string" || !obj["name"]) {
        throw new WorkflowSpecLoadError("invalid_op", RUN_SPEC_ACCEPTED_SHAPES_MESSAGE);
    }
    if (!Array.isArray(obj["tasks"]) || obj["tasks"].length === 0) {
        throw new WorkflowSpecLoadError("invalid_op", RUN_SPEC_ACCEPTED_SHAPES_MESSAGE);
    }
    const tasks = obj["tasks"].map((t, i) => {
        if (typeof t !== "object" || t === null) {
            throw new Error(`Task ${i + 1} must be an object.`);
        }
        const task = t;
        const rawInput = task["input"];
        const hasExplicitInput = typeof rawInput === "string" && rawInput.length > 0;
        const sr = task["structuredReplace"];
        const structuredReplace = sr && typeof sr === "object" && !Array.isArray(sr) &&
            typeof sr["oldValue"] === "string" &&
            typeof sr["newValue"] === "string" &&
            typeof sr["filePath"] === "string"
            ? sr
            : undefined;
        // friction #82 — reject dual source-of-truth tasks at load time.
        // JSON/batch surfaces intentionally carry a parser-stable placeholder
        // `input` alongside authoritative `structuredReplace`; allow that pair
        // when `input` matches the JSON adapter placeholder shape (see
        // spec-task-builder.ts). Reject when both are present AND `input` is
        // not the canonical NL derived from `structuredReplace` — the #82 repro
        // had `input: "rename …"` with a replace-shaped structuredReplace.
        if (hasExplicitInput && structuredReplace !== undefined) {
            const canonical = canonicalInputFromStructuredReplace(structuredReplace);
            const inputText = rawInput;
            const isJsonPlaceholder = /^replace "x" with "y" in .+$/.test(inputText);
            if (!isJsonPlaceholder && inputText !== canonical) {
                throw new WorkflowSpecLoadError("conflicting_input_sources", `Task ${i + 1}: ${CONFLICTING_INPUT_SOURCES_MESSAGE}`);
            }
        }
        if (!hasExplicitInput && structuredReplace === undefined) {
            throw new Error(`Task ${i + 1} must have a non-empty "input" string.`);
        }
        const taskInput = hasExplicitInput
            ? rawInput
            : canonicalInputFromStructuredReplace(structuredReplace);
        const runtime = task["runtime"];
        if (runtime !== undefined && runtime !== "cursor" && runtime !== "claude") {
            throw new Error(`Task ${i + 1} has an invalid "runtime" value: ${JSON.stringify(runtime)}. ` +
                `Expected "cursor" or "claude".`);
        }
        const targetFiles = task["targetFiles"];
        if (targetFiles !== undefined) {
            if (!Array.isArray(targetFiles) || targetFiles.length === 0) {
                throw new Error(`Task ${i + 1} "targetFiles" must be a non-empty array of strings.`);
            }
            for (const f of targetFiles) {
                if (typeof f !== "string" || !f) {
                    throw new Error(`Task ${i + 1} "targetFiles" must contain non-empty strings.`);
                }
            }
        }
        const operationType = task["operationType"];
        if (operationType !== undefined &&
            operationType !== "replace" &&
            operationType !== "create_dir" &&
            operationType !== "write_file" &&
            operationType !== "rename" &&
            operationType !== "delete_file" &&
            operationType !== "append_file" &&
            operationType !== "prepend_file" &&
            operationType !== "run_command") {
            throw new Error(`Task ${i + 1} has an invalid "operationType" value: ${JSON.stringify(operationType)}.`);
        }
        const content = typeof task["content"] === "string" ? task["content"] : undefined;
        const newPath = typeof task["newPath"] === "string" ? task["newPath"] : undefined;
        const command = typeof task["command"] === "string" ? task["command"] : undefined;
        // F8-W4 / usesteady-public#45 — preserve the user's explicit
        // occurrence directive (the diagnostics/render slot on
        // WorkflowTaskSpec) so the approval surface can disclose it. Only
        // "first" is forwarded: it is the sole value consistent with the
        // uniqueness-only executor. Non-"first" from NL synthesis is refused
        // upstream (ir-to-spec-fields); a raw non-"first" value keeps the
        // pre-existing drop behavior — no new silent semantics, no new
        // rejection.
        const rawRequestedOccurrence = task["requestedOccurrence"];
        const requestedOccurrence = rawRequestedOccurrence === "first" ? "first" : undefined;
        // S4 / friction #44 — if no structured fields are present, route the
        // NL `input` through the canonical normalizer at load-time.
        const hasStructured = operationType !== undefined ||
            structuredReplace !== undefined ||
            content !== undefined ||
            command !== undefined ||
            newPath !== undefined;
        let synthOperationType = operationType;
        let synthTargetFiles = undefined;
        let synthContent = content;
        let synthNewPath = newPath;
        let synthCommand = command;
        let synthStructuredReplace = structuredReplace;
        let synthRequestedOccurrence = undefined;
        if (!hasStructured) {
            const result = synthesizeStructuredFieldsFromNL(taskInput);
            if (!result.ok) {
                // Web UI parity (`server.ts`): failed synthesis leaves raw NL;
                // coordinator routes unparseable tasks to `skipped_by_intake`.
                // R4 / mapping failures remain hard rejects at load time.
                if (isNlRecoveryEligibleFailure(result)) {
                    return {
                        input: taskInput,
                        ...(typeof task["label"] === "string" && task["label"] ? { label: task["label"] } : {}),
                        ...(runtime ? { runtime: runtime } : {}),
                        ...(targetFiles ? { targetFiles: targetFiles } : {}),
                    };
                }
                throw new WorkflowSpecLoadError("invalid_op", `Task ${i + 1} input could not be parsed as a supported NL operation: ` +
                    `${result.reason}\n` +
                    `  Input: ${JSON.stringify(taskInput)}\n` +
                    `  See \`usesteady --help\` for the supported NL grammar, or pass ` +
                    `\`operationType\`/\`structuredReplace\` directly to bypass NL parsing.`);
            }
            const f = result.fields;
            if (f.operationType !== undefined)
                synthOperationType = f.operationType;
            if (f.targetFiles !== undefined)
                synthTargetFiles = f.targetFiles;
            if (f.content !== undefined)
                synthContent = f.content;
            if (f.newPath !== undefined)
                synthNewPath = f.newPath;
            if (f.command !== undefined)
                synthCommand = f.command;
            if (f.structuredReplace !== undefined)
                synthStructuredReplace = f.structuredReplace;
            // F8-W4 — the mapper only ever yields "first" (non-"first" is a
            // load refusal); the === "first" guard is belt-and-braces typing.
            if (f.requestedOccurrence === "first")
                synthRequestedOccurrence = "first";
        }
        const finalTargetFiles = targetFiles ?? synthTargetFiles;
        const finalRequestedOccurrence = requestedOccurrence ?? synthRequestedOccurrence;
        return {
            input: taskInput,
            ...(typeof task["label"] === "string" && task["label"] ? { label: task["label"] } : {}),
            ...(runtime ? { runtime: runtime } : {}),
            ...(finalTargetFiles ? { targetFiles: finalTargetFiles } : {}),
            ...(synthOperationType ? { operationType: synthOperationType } : {}),
            ...(synthContent !== undefined ? { content: synthContent } : {}),
            ...(synthNewPath !== undefined ? { newPath: synthNewPath } : {}),
            ...(synthCommand !== undefined ? { command: synthCommand } : {}),
            ...(synthStructuredReplace ? { structuredReplace: synthStructuredReplace } : {}),
            ...(finalRequestedOccurrence !== undefined ? { requestedOccurrence: finalRequestedOccurrence } : {}),
        };
    });
    const defaultRuntime = obj["defaultRuntime"];
    if (defaultRuntime !== undefined && defaultRuntime !== "cursor" && defaultRuntime !== "claude") {
        throw new Error(`"defaultRuntime" has an invalid value: ${JSON.stringify(defaultRuntime)}. ` +
            `Expected "cursor" or "claude".`);
    }
    return {
        name: obj["name"],
        tasks,
        ...(defaultRuntime ? { defaultRuntime: defaultRuntime } : {}),
        ...(typeof obj["maxRetries"] === "number" ? { maxRetries: obj["maxRetries"] } : {}),
    };
}
//# sourceMappingURL=workflow-spec-loader.js.map