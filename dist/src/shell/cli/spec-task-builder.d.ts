/**
 * Shared SpecTask builder for the JSON-accepting input surfaces.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 *
 * One canonical "JSON op (or IR Operation) → WorkflowSpec.tasks[]" converter
 * used by every CLI surface that takes JSON ops as input:
 *
 *   1. `--json '<op>'`   (single op or array)         — `processJsonInput`
 *   2. `batch <file>`    (always array)               — `processJsonInput`
 *   3. `run <spec.json>` when the file holds a single op or an op array
 *                        (auto-wrap, S3 / friction #40) — `loadWorkflowSpecFromFile`
 *
 * Before this module existed, the `--json` / `batch` SpecTask synthesis lived
 * inline in `processJsonInput` (`src/shell/cli/use-steady.ts`). Adding the
 * `run <spec.json>` auto-wrap path needed the same logic, so the builder was
 * extracted to a shared, side-effect-free module to PREVENT divergent shapes
 * across surfaces (the exact friction class — Input Surface Integrity — that
 * the alpha.49 governance lock is designed to catch).
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *
 *   * No I/O, no logging, no telemetry, no env reads.
 *   * Pure conversion: `IR Operation[]` → `SpecTask[]`.
 *   * `create_dir` is synthesized DIRECTLY (it has no `DraftTask.action`
 *     variant — `irOperationToJsonDraftTask` throws on it by design).
 *   * The other 7 ops round-trip `IR → DraftTask → SpecTask` so the
 *     `structuredReplace` / `operationType` / `targetFiles` / `content` /
 *     `command` fields are populated identically to the alpha.47 contract.
 *   * The `input` field carries a canonical NL phrasing per op so the
 *     workflow loop's "SYSTEM WILL → ..." preview frame still has a
 *     human-readable line even when the source was JSON.
 *
 * ── Out of scope (per S3 / #40 lock) ────────────────────────────────────────
 *
 *   * Safety gate / feasibility validator — those run at the input-surface
 *     layer (in `processJsonInput`) and per-task at execution time. This
 *     module never invokes either.
 *   * UCP shadow-envelope persistence — kept inline in `processJsonInput`
 *     because it is `--json` / `batch` specific (the run-spec auto-wrap
 *     path does not duplicate that side effect — UCP is not in scope for
 *     the run-spec contract repair).
 *   * Telemetry / kernel artifact / executor — none touched.
 */
import type { Operation } from "../../input/ir.js";
/**
 * The synthesized `WorkflowSpec.tasks[]` entry produced by every JSON-input
 * surface.
 *
 * Mirrors the shape `loadWorkflowSpecFromFile` accepts and the workflow
 * coordinator consumes. Keep additive — new optional fields are fine; never
 * remove or rename a field without coordinated updates in:
 *   * `src/workflow/types.ts` (WorkflowSpec.tasks element type)
 *   * `src/shell/cli/main.ts` (`loadWorkflowSpecFromFile` task-shape parser)
 *   * `src/shell/cli/use-steady.ts` (`processJsonInput` consumers)
 */
export type SpecTask = {
    readonly input: string;
    readonly label: string;
    readonly operationType?: "replace" | "create_dir" | "write_file" | "rename" | "delete_file" | "append_file" | "prepend_file" | "run_command";
    readonly targetFiles?: readonly string[];
    readonly content?: string;
    readonly newPath?: string;
    readonly command?: string;
    readonly structuredReplace?: {
        readonly oldValue: string;
        readonly newValue: string;
        readonly filePath: string;
    };
    /**
     * usesteady-public#45 — the user's explicit replace occurrence directive.
     *
     * Diagnostics / preview only. Mirrored from
     * `WorkflowTaskSpec.requestedOccurrence` (see that JSDoc for the full
     * contract). The executor MUST NOT read this field; only `structured-
     * Replace` is executable.
     *
     * Populated by `buildSpecTasksFromIROps` (this module) and
     * `mapIROpToStructuredFields` (ir-to-spec-fields.ts) only when the IR
     * carries `requestedOccurrence` — i.e. the user *explicitly* specified
     * an occurrence directive. When absent, the legacy no-directive
     * behavior is preserved byte-for-byte.
     */
    readonly requestedOccurrence?: "first" | "all" | {
        readonly index: number;
    };
};
/**
 * Convert a single `DraftTask` to a `SpecTask` with the structured fields
 * (`structuredReplace` / `operationType` / `targetFiles` / `content` /
 * `command`) populated where the action carries them. Used only by the
 * seven ops that round-trip through `irOperationToJsonDraftTask`
 * (everything except `create_dir`).
 *
 * `i` is the zero-based op index — used to label the synthesized task
 * `Step ${i+1}` so the workflow loop's preview frame matches the
 * pre-extraction behavior byte-for-byte.
 */
export declare function draftTaskToSpecTask(t: any, i: number): SpecTask;
/**
 * Convert an array of IR `Operation`s to a `SpecTask[]` ready to drop into a
 * `WorkflowSpec`'s `tasks` field.
 *
 * Branches on `op.type === "create_dir"` BEFORE `irOperationToJsonDraftTask`
 * because the shim throws on `create_dir` by design (post-alpha.47). For
 * `create_dir`, synthesizes the SpecTask directly with `operationType:
 * "create_dir"` and `targetFiles: [path]`, matching the bypass in
 * `processJsonInput` and `processNLInput`.
 *
 * Pure: never throws unless a caller passes an invalid `Operation` shape
 * (which would already have failed `jsonOpToIROperation`).
 */
export declare function buildSpecTasksFromIROps(ops: readonly Operation[]): SpecTask[];
//# sourceMappingURL=spec-task-builder.d.ts.map