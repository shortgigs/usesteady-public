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
import { irOperationToJsonDraftTask } from "../../input/ir-to-draft.js";
import { draftTaskToInput } from "./draft/intent-to-tasks.js";
// S4 — shared IR → structured-fields mapper. Pre-S4 the JSON-op path here
// only synthesized `replace`/`append`/`prepend`/`run_command` and let
// `create`/`delete`/`rename` fall through to a no-structured-fields
// SpecTask (the coordinator's removed `parseChange` fallback used to fill
// the gap). Post-S4 every IR op produces structured fields here so the
// coordinator's pure structured-only path executes them. Single source of
// truth lives in `ir-to-spec-fields.ts` so this path and the WorkflowSpec
// NL synth (`spec-nl-synth.ts`) cannot drift.
import { mapIROpToStructuredFields } from "./ir-to-spec-fields.js";
// ── DraftTask → SpecTask (legacy seven-op variants) ──────────────────────────
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
export function draftTaskToSpecTask(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
t, i) {
    if (t.action === "replace" && t.from !== undefined && t.to !== undefined && t.file !== undefined) {
        // The `input` field is intentionally a stable placeholder. It is NOT
        // the user-facing display string — the renderer derives that from
        // `structuredReplace` when present (see `truthfulInputDisplay` in
        // `src/shell/workflow-render.ts`, S4 / friction #43). Keeping
        // `input` as a parser-stable canonical form preserves the existing
        // intake / parse-stage behavior (which still receives this string
        // even though `structuredReplace` carries the authoritative values
        // for execution). The placeholder wording matches the alpha.49
        // shape (`replace "x" with "y" in <file>`) for byte-identical
        // structural output across surfaces.
        return {
            input: `replace "x" with "y" in ${t.file}`,
            label: `Step ${i + 1}`,
            structuredReplace: { oldValue: t.from, newValue: t.to, filePath: t.file },
        };
    }
    if (t.action === "append" && t.to !== undefined && t.file !== undefined) {
        return {
            input: `append "${t.to}" to ${t.file}`,
            label: `Step ${i + 1}`,
            operationType: "append_file",
            targetFiles: [t.file],
            content: t.to,
        };
    }
    if (t.action === "prepend" && t.to !== undefined && t.file !== undefined) {
        return {
            input: `prepend "${t.to}" to ${t.file}`,
            label: `Step ${i + 1}`,
            operationType: "prepend_file",
            targetFiles: [t.file],
            content: t.to,
        };
    }
    if (t.action === "run_command" && t.to !== undefined) {
        return {
            input: `run ${t.to}`,
            label: `Step ${i + 1}`,
            operationType: "run_command",
            command: t.to,
        };
    }
    return {
        input: draftTaskToInput(t),
        label: `Step ${i + 1}`,
    };
}
// ── IR Operation[] → SpecTask[] (full converter, all 8 ops) ──────────────────
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
export function buildSpecTasksFromIROps(ops) {
    return ops.map((op, i) => {
        // `create_dir` keeps a friendly NL `input` ("create folder <path>")
        // for the rendered "You asked:" line. The structured fields come
        // from the shared mapper.
        if (op.type === "create_dir") {
            const result = mapIROpToStructuredFields(op);
            // create_dir always succeeds in the mapper.
            if (!result.ok)
                throw new Error(`internal: create_dir mapper failed: ${result.reason}`);
            return {
                input: `create folder ${op.args.path}`,
                label: `Step ${i + 1}`,
                ...result.fields,
            };
        }
        // S4: every other op also goes through the shared mapper so the
        // structured fields are populated identically to the WorkflowSpec
        // NL synth path. The legacy `irOperationToJsonDraftTask` →
        // `draftTaskToSpecTask` path is kept ONLY to derive a friendly
        // `input` string for display (`draftTaskToInput`) and to preserve
        // the legacy `replace` placeholder shape (`replace "x" with "y" in
        // <file>`) that downstream display code already understands.
        const draft = irOperationToJsonDraftTask(op);
        const legacy = draftTaskToSpecTask(draft, i);
        // `replace` from the JSON adapter is the one op where the shared
        // mapper's R4-strict gate is too strict for THIS surface. The JSON
        // adapter defaults to `occurrence: "all"` (json-to-ir.ts) but the
        // existing `WorkflowTaskSpec.structuredReplace` doesn't carry an
        // occurrence field; pre-S4 the value was silently dropped at this
        // conversion and the executor used first-match. That is a
        // pre-existing silent default that S4 is not changing in this PR.
        // We synthesize `structuredReplace` directly here, keeping the
        // legacy SpecTask intact for the input string. The NL synth path
        // (`spec-nl-synth.ts`) stays strict because users on `--prompt` /
        // WorkflowSpec NL must opt in to a specific occurrence under R4.
        //
        // usesteady-public#45 — the JSON surface now ALSO carries
        // `requestedOccurrence` when the user explicitly provided one in
        // the public JSON op. The validate-stage refusal in
        // `feasibility-validator.ts` already caught non-"first" directives
        // BEFORE this builder runs (see processJsonInput in use-steady.ts
        // — `validateIR` is called between `buildIRFromJsonOps` and
        // `buildSpecTasksFromIROps`). So when the IR reaches this code
        // with `requestedOccurrence` set, the value is "first" only. We
        // still mirror it onto the SpecTask so the preview / diagnostic
        // surfaces can render the user's directive. Executor behavior
        // unchanged.
        if (op.type === "replace") {
            return {
                ...legacy,
                ...(op.args.requestedOccurrence !== undefined
                    ? { requestedOccurrence: op.args.requestedOccurrence }
                    : {}),
                structuredReplace: {
                    oldValue: op.args.from,
                    newValue: op.args.to,
                    filePath: op.args.file,
                },
            };
        }
        const fields = mapIROpToStructuredFields(op);
        if (!fields.ok) {
            // Defensive: every non-replace op succeeds in the mapper today.
            throw new Error(`internal: IR op cannot be expressed in SpecTask fields: ${fields.reason}`);
        }
        return {
            ...legacy,
            ...fields.fields,
        };
    });
}
//# sourceMappingURL=spec-task-builder.js.map