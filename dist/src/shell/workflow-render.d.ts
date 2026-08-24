/**
 * Phase 9D: Workflow shell rendering.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure function that maps WorkflowRun state → ShellFrame.
 *   No I/O. No coordinator calls. No authority.
 *
 * ── Two-layer read rule (WS6) ─────────────────────────────────────────────────
 *
 *   1. Read WorkflowRun.phase first — determines the frame type and prompt kind.
 *   2. Read currentSession.state.display second — provides task-level detail
 *      (change summary, conflict list, scope candidates, failure note).
 *
 *   Never conflate workflow phase with session phase. See docs/phase-9c-baseline.md
 *   for the full phase distinction table.
 *
 * ── Key invariants (WS1–WS5) ──────────────────────────────────────────────────
 *
 *   WS1: Pure — no side effects, no state mutation.
 *   WS3: task_failed prompt is always "choose" (stop/skip/retry), never "confirm".
 *        A choice prompt cannot imply a default the way a yes/no confirm can.
 *   WS4: Failure note from display.failureNote is preserved verbatim.
 *        exec_error, blocked, rejected, and missing-plugin all have distinct notes.
 *        The renderer never replaces these with a generic "task failed" message.
 *   WS5: completed/stopped frames read history from run.tasks[i].outcome, not
 *        from currentSession (which is absent in those phases).
 *
 * ── task_approved rendering (9C distinction) ──────────────────────────────────
 *
 *   task_approved renders as "Approved — ready to deliver."
 *   Never as "Accepted" or "Completed". Those are delivery outcomes.
 *   The advance functions collapse approve+deliver into one user action, so
 *   task_approved is usually a transient frame — but it must not visually blur.
 *
 * See: docs/phase-9c-baseline.md — workflow/session phase distinction
 *      docs/phase-9d-baseline.md — Phase 9D freeze record
 */
import type { WorkflowRun, WorkflowTaskSpec } from "../workflow/types.js";
import type { ShellFrame } from "./types.js";
/**
 * S4 / friction #43 — Output truthfulness.
 *
 * The `input` field on a SpecTask is sometimes a stable parser placeholder
 * (e.g. `replace "x" with "y" in <file>` for tasks built from JSON op
 * shapes via `buildSpecTasksFromIROps`). Rendering that placeholder as
 * the "You asked:" line lies to the user — they see fabricated `x`/`y`
 * values for a replace whose real `from`/`to` come from `structuredReplace`.
 *
 * The fix: render from the authoritative source. When `structuredReplace`
 * is set, derive the display string from `oldValue`/`newValue`/`filePath`.
 * Otherwise return `input` verbatim (the NL surfaces already carry the
 * literal user text). This is a render-only transform — `taskSpec.input`
 * stays parser-stable, the executor still uses `structuredReplace`.
 *
 * Quote-escape any embedded `"` so the rendered string is unambiguous.
 * The result is for human display only and is never re-parsed.
 *
 * Exported for the F10-W2 entry-layer pre-approval surface
 * (`src/shell/cli/entry-approval-preview.ts`) so the one-shot intake
 * echo anchors the exact same canonical string the task_ready frame
 * shows — one display truth, two lifecycle stages.
 */
export declare function truthfulInputDisplay(taskSpec: {
    readonly input: string;
    readonly structuredReplace?: {
        readonly oldValue: string;
        readonly newValue: string;
        readonly filePath: string;
    };
}): string;
export declare function operationPreviewLines(taskSpec: WorkflowTaskSpec): readonly string[];
/**
 * Compact per-task preview for the multi-task `reviewing` phase.
 *
 * Shorter than `operationPreviewLines` (one or two indented lines per
 * task) so a batch of N tasks still fits on screen at review time.
 * The full preview shows again per-task at `task_ready` approval.
 *
 * Same determinism, same source of truth (`WorkflowTaskSpec`
 * structured fields), same no-paraphrase rule. Returns `[]` for
 * unstructured tasks.
 */
export declare function operationReviewSummaryLines(taskSpec: WorkflowTaskSpec): readonly string[];
/**
 * Render a WorkflowRun into a ShellFrame.
 *
 * WS1: Pure — no I/O, no side effects.
 * WS6: Returns the same ShellFrame contract as renderCursorFrame /
 *      renderClaudeFrame. A generic shell loop can drive all three without
 *      special workflow logic.
 *
 * Two-layer read rule:
 *   1. Switch on run.phase (workflow coordinator layer).
 *   2. Read currentSession.state.display for task-level detail (session layer).
 */
/**
 * F10-W2 — presentation-only render options.
 *
 * `auditTrailOnly`: set by the CLI loop when the frame's confirm gate
 * will be auto-confirmed without a human at the terminal (delegated
 * one-shot `--yes`, or an operator-supplied `--yes`). The frame keeps
 * every disclosure line (SYSTEM WILL, preview, detail) but the
 * task_ready header renders `WILL RUN` instead of the actionable
 * decision header `APPROVE?` — no approval can actually be supplied at
 * that point, so presenting a decision surface would be a false
 * affordance (Stuart Finding 10, presentation-order remediation).
 *
 * Default (undefined / false) preserves the pre-F10-W2 byte output
 * exactly. The web surface (`server.ts` runResponse) never sets this —
 * its approval gate is real and keeps the `APPROVE?` header.
 */
export type WorkflowFrameRenderOptions = {
    readonly auditTrailOnly?: boolean;
};
export declare function renderWorkflowFrame(run: WorkflowRun, opts?: WorkflowFrameRenderOptions): ShellFrame;
//# sourceMappingURL=workflow-render.d.ts.map