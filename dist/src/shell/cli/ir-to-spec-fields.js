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
export function mapIROpToStructuredFields(op) {
    switch (op.type) {
        case "create_dir":
            return {
                ok: true,
                fields: {
                    operationType: "create_dir",
                    targetFiles: [op.args.path],
                },
            };
        case "create":
            // M4 IR's `create` op is a writable file with optional contents.
            // The executor models this as `write_file` with `content` (empty
            // string when not specified — same default the legacy `parseChange`
            // "create file" path produced).
            return {
                ok: true,
                fields: {
                    operationType: "write_file",
                    targetFiles: [op.args.path],
                    content: op.args.contents ?? "",
                },
            };
        case "delete":
            return {
                ok: true,
                fields: {
                    operationType: "delete_file",
                    targetFiles: [op.args.path],
                },
            };
        case "rename":
            return {
                ok: true,
                fields: {
                    operationType: "rename",
                    targetFiles: [op.args.from],
                    newPath: op.args.to,
                },
            };
        case "replace": {
            if (op.args.occurrence !== "first") {
                const occText = op.args.occurrence === "all"
                    ? "all occurrences"
                    : `${op.args.occurrence.index}${ordinalSuffix(op.args.occurrence.index)} occurrence`;
                // usesteady-public#45 — the executor does not honor occurrence
                // selection today (execution is uniqueness-only: the replace
                // runs only on an exactly-one match and refuses on >1-match
                // content — it never selects the first of several matches).
                // Both the NL surface and the `--json` / `batch` surface drop
                // the directive before execution. The pre-#45 reason text
                // pointed users to "--json / batch which carries full
                // occurrence semantics" — that was wrong. The reason text now
                // describes the actual state and links to the issue.
                return {
                    ok: false,
                    reason: `replace with "${occText}" is not yet supported. The executor ` +
                        "does not honor occurrence selection today (execution is " +
                        "uniqueness-only: a unique match is required; multiple " +
                        "matches are refused with ambiguous_match, never selected). " +
                        "Tracked at usesteady-public#45. Workaround: narrow `from` " +
                        "to a unique span in the file, or apply the change manually " +
                        "for now.",
                };
            }
            return {
                ok: true,
                fields: {
                    // usesteady-public#45 — propagate the user's explicit directive
                    // (when present) to the SpecTask so the preview / diagnostic
                    // surface can echo it. Only "first" reaches here (the non-
                    // "first" branch above refuses early). When `requestedOccurrence`
                    // is set on the IR (NL surface always; JSON surface when the
                    // public op included the field), we mirror it onto the
                    // structured-fields output. The executor still does not read
                    // this field — it is for rendering only.
                    ...(op.args.requestedOccurrence !== undefined
                        ? { requestedOccurrence: op.args.requestedOccurrence }
                        : {}),
                    structuredReplace: {
                        oldValue: op.args.from,
                        newValue: op.args.to,
                        filePath: op.args.file,
                    },
                },
            };
        }
        case "append":
            return {
                ok: true,
                fields: {
                    operationType: "append_file",
                    targetFiles: [op.args.file],
                    content: op.args.text,
                },
            };
        case "prepend":
            return {
                ok: true,
                fields: {
                    operationType: "prepend_file",
                    targetFiles: [op.args.file],
                    content: op.args.text,
                },
            };
        case "run":
            return {
                ok: true,
                fields: {
                    operationType: "run_command",
                    command: op.args.command,
                },
            };
    }
}
function ordinalSuffix(n) {
    const lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 13)
        return "th";
    switch (n % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
    }
}
//# sourceMappingURL=ir-to-spec-fields.js.map