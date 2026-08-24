/**
 * src/shell/cli/ir-to-spec-fields.ts
 *
 * S4 — Single source of truth for the IR `Operation` → `WorkflowTaskSpec`
 * structured-fields mapping.
 *
 * Two callers consume this:
 *
 *   1. `synthesizeStructuredFieldsFromNL` (`spec-nl-synth.ts`) — used at
 *      `loadWorkflowSpecFromFile` to populate structured fields when a
 *      WorkflowSpec task arrives with only an NL `input`.
 *
 *   2. `buildSpecTasksFromIROps` / `draftTaskToSpecTask`
 *      (`spec-task-builder.ts`) — used by `--json` / `batch` /
 *      `run <op>.json` to populate structured fields when JSON ops are
 *      converted to SpecTasks.
 *
 * Both paths must produce IDENTICAL structured fields for the same IR
 * op. Pre-S4 they didn't: `draftTaskToSpecTask` had branches for
 * `replace` / `append` / `prepend` / `run_command` only, and silently
 * fell through to a no-structured-fields SpecTask for `create` /
 * `delete` / `rename`. The coordinator's removed `parseChange` fallback
 * had been masking the gap. Centralising the mapping here closes it.
 *
 * Trust contract (S4 / R4 — uniform):
 *   `replace` synthesis only succeeds for `occurrence === "first"`.
 *   The existing `WorkflowTaskSpec.structuredReplace` shape does not
 *   carry an `occurrence` field, so synthesizing for `all` / N-th would
 *   silently default to first at execution — exactly the kind of drift
 *   R4 was designed to stop. Callers handle the `ok: false` case
 *   appropriately (the NL synth wraps it in `WorkflowSpecLoadError`).
 *
 *   usesteady-public#45 update: the JSON `--json` / `batch` surface now
 *   also enforces this via `validateReplace` in
 *   `src/input/feasibility-validator.ts` (validate-stage refusal with
 *   `ambiguous_match` when `requestedOccurrence` is non-"first"). On the
 *   WorkflowSpec NL `loadWorkflowSpecFromFile` path this `ok: false`
 *   branch is the active gate (the validator is not invoked at spec-load
 *   time). Pre-#45 the reason text directed users to "the IR-shape
 *   replace op (via --json / batch) which carries full occurrence
 *   semantics" — that pointer was incorrect because the JSON adapter
 *   also did not honor `occurrence`. The reason text below now describes
 *   the actual current state without pointing the user at a workaround
 *   that does not exist.
 */
import type { Operation } from "../../input/ir.js";
import type { WorkflowTaskSpec } from "../../workflow/types.js";
export type StructuredFields = Pick<WorkflowTaskSpec, "operationType" | "targetFiles" | "content" | "newPath" | "command" | "structuredReplace" | "requestedOccurrence">;
export type MapResult = {
    readonly ok: true;
    readonly fields: StructuredFields;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function mapIROpToStructuredFields(op: Operation): MapResult;
//# sourceMappingURL=ir-to-spec-fields.d.ts.map