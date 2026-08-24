/**
 * src/shell/cli/draft/intent-to-tasks.ts
 *
 * Pure intent translator — maps free-text user input to a structured list of
 * DraftTasks before the user commits to execution.
 *
 * No I/O, no external deps, no side effects.
 * Returns best-effort results: unrecognised clauses get needs_confirmation=true
 * with rawText preserved so the caller never loses the original intent.
 */
export type DraftTask = {
    readonly action: "replace" | "rename" | "create" | "delete" | "run_command" | "append" | "prepend";
    readonly from?: string;
    readonly to?: string;
    readonly file?: string;
    readonly needs_confirmation?: true;
    readonly rawText?: string;
};
export declare function translateIntent(text: string): DraftTask[];
/**
 * Format a DraftTask as a human-readable one-liner for CLI display.
 * Unrecognised clauses are prefixed with "?" to signal they need review.
 *
 * alpha.56 / F-A55-1: every user-authored value embedded into this
 * line (`task.from`, `task.to`, `task.file`, `task.rawText`) is
 * routed through `escapeControlForInline` from the shared
 * `render-escape` module — the same primitive the SYSTEM WILL
 * Preview block uses. This guarantees tab/CR/newline characters
 * in user content never forge a second visual line inside the
 * pre-approval echo. The transform is identical across all
 * adjacent surfaces (intake echo, You-asked anchor, Preview
 * content), so a first-time user never sees the same content
 * rendered two different ways before approval.
 */
export declare function formatDraftTask(task: DraftTask): string;
/**
 * Convert a DraftTask to the canonical input string accepted by the existing
 * intake pipeline (cursor-product-session / coordinator).
 *
 * Parsed tasks produce the canonical replace/rename/create/delete/run format
 * that the intent parser already understands. Path tokens that contain
 * whitespace or backslashes are re-quoted so the downstream parser does
 * not truncate them at the first whitespace character.
 *
 * Unrecognised clauses pass rawText through — they will be handled as
 * skipped_by_intake if still unrecognised at runtime.
 */
export declare function draftTaskToInput(task: DraftTask): string;
/**
 * JsonOp — structured input type for --json and --batch modes.
 *
 * CLI adapter only. Not a UCP envelope. Must not grow: no nested logic,
 * no conditionals, no policy flags. All ops converge to DraftTask and
 * enter the same workflow engine as natural-language input.
 */
export type JsonOp = {
    readonly type: "rename" | "replace" | "create" | "delete" | "run" | "append" | "prepend";
    readonly from?: string;
    readonly to?: string;
    readonly file?: string;
};
/**
 * Convert a raw unknown value (from JSON.parse) to a DraftTask.
 * Returns null for unknown types or missing required fields.
 * Caller must treat null as exit 2 (parse / recognition failure).
 */
export declare function jsonOpToDraftTask(raw: unknown): DraftTask | null;
//# sourceMappingURL=intent-to-tasks.d.ts.map