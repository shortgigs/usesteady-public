/**
 * F10-W2 — informed pre-approval surface for the one-shot CLI entry paths
 * (`--json` / `batch` / NL `--prompt`·stdin·argv / legacy draft).
 *
 * Stuart Finding 10 (presentation-order): on the one-shot paths the
 * operative plan-level approval (`Approve these steps?`) rendered only a
 * coarse `[parsed]` echo, while the decision-relevant detail (operation
 * kind, target, canonical anchor, permanence/existence warnings) appeared
 * seconds later in the delegated workflow's REVIEW / SYSTEM WILL frames —
 * after the approval had already been taken.
 *
 * This module closes that ordering gap WITHOUT adding a second approval
 * and WITHOUT a new interpretation of operation semantics:
 *
 *   1. Same truth source — the enrichment is composed from the existing
 *      pure renderers `truthfulInputDisplay` (the task_ready frame's
 *      "You asked:" anchor) and `operationPreviewLines` (the SYSTEM WILL
 *      preview block). Nothing here re-derives or paraphrases operation
 *      semantics.
 *   2. Same structured fields the executor will see — tasks that arrive
 *      without structured fields (delete / rename / create round-trip
 *      through the DraftTask default branch) are enriched via
 *      `synthesizeStructuredFieldsFromNL`, the exact deterministic
 *      synthesizer `loadWorkflowSpecFromFile` applies to the same
 *      canonical `input` strings at spec-load time. The `hasStructured`
 *      guard below mirrors the loader's check field-for-field.
 *   3. Fail-closed — when synthesis fails (unparseable NL), the function
 *      returns `[]` and the echo line stands alone. Downstream such a
 *      task routes to `skipped_by_intake`; the pre-approval surface must
 *      not fabricate a preview the executor will never see.
 *   4. Pure render — no I/O, no mutation, no execution. Identical input
 *      produces identical bytes.
 *
 * Authority note: the approval itself is unchanged — plan-level, exactly
 * once, at the entry layer (commit 6bca325). This module only changes
 * WHAT is printed before that single prompt.
 */
import { operationPreviewLines, truthfulInputDisplay, } from "../workflow-render.js";
import { synthesizeStructuredFieldsFromNL } from "./spec-nl-synth.js";
/**
 * Decision-relevant detail lines for one entry-echoed task, indented to
 * nest under the `  [parsed] Step N:` line. Returns `[]` when the task
 * carries no derivable structured operation (same contract as
 * `operationPreviewLines` on unstructured tasks).
 *
 * Accepts any `WorkflowTaskSpec`-shaped task object — the entry-layer
 * `SpecTask` is structurally assignable to it, and the effect-closure
 * authority test exercises the same function with spec fixtures.
 */
export function entryApprovalDetailLines(task) {
    // Mirror of the loader's structured-field presence check
    // (`workflow-spec-loader.ts`, S4 / friction #44). Field-for-field
    // identical so the entry surface and the load-time surface agree on
    // which tasks need NL synthesis.
    const hasStructured = task.operationType !== undefined ||
        task.structuredReplace !== undefined ||
        task.content !== undefined ||
        task.command !== undefined ||
        task.newPath !== undefined;
    let enriched = task;
    if (!hasStructured) {
        const synth = synthesizeStructuredFieldsFromNL(task.input);
        if (!synth.ok)
            return [];
        enriched = { ...task, ...synth.fields };
    }
    const preview = operationPreviewLines(enriched);
    if (preview.length === 0)
        return [];
    return [
        `    You asked:  ${truthfulInputDisplay(enriched)}`,
        // Re-indent the frame-shaped preview block (+2) so it nests visually
        // under the `[parsed] Step N:` echo line.
        ...preview.map(ln => `  ${ln}`),
    ];
}
//# sourceMappingURL=entry-approval-preview.js.map