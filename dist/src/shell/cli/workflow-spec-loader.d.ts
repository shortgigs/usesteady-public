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
import type { WorkflowSpec } from "../../workflow/types.js";
import type { CanonicalErrorCode } from "../../kernel/error-codes.js";
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
export declare class WorkflowSpecLoadError extends Error {
    readonly code: CanonicalErrorCode;
    constructor(code: CanonicalErrorCode, message: string);
}
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
export declare function loadWorkflowSpecFromFile(filePath: string): WorkflowSpec;
//# sourceMappingURL=workflow-spec-loader.d.ts.map