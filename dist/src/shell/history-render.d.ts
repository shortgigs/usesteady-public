/**
 * Phase 10C: History / Audit shell rendering.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure function that maps HistoryView state → ShellFrame.
 *   No I/O. No store reads. No authority.
 *
 * ── Two views ─────────────────────────────────────────────────────────────────
 *
 *   list   — WorkflowHistorySummary[] rendered as a numbered list.
 *            Prompt: "choose" so the user can select a run by number.
 *            When empty: no prompt (terminal — CLI loop exits or re-prompts).
 *
 *   detail — WorkflowAuditRecord rendered as full per-task session chain.
 *            Prompt: "confirm" to return to list.
 *
 * ── Key invariants (HR1–HR4) ──────────────────────────────────────────────────
 *
 *   HR1: Pure — no side effects, no store reads, no I/O.
 *   HR2: No live WorkflowRun objects enter this module.
 *        The view types carry already-resolved read-model data.
 *   HR3: Empty history list renders with no prompt (loop can exit cleanly).
 *        A choose prompt is only emitted when there is at least one run.
 *   HR4: Session chain detail (cursor/claude, handoff/receipt/refused) is
 *        rendered for every task that has a non-null session. Tasks with
 *        null session render as "(no session)".
 *
 * See: docs/phase-10a-history-audit-design.md — design record
 *      docs/phase-10c-baseline.md             — freeze record
 */
import type { WorkflowHistorySummary, WorkflowAuditRecord } from "../history/types.js";
import type { ShellFrame } from "./types.js";
/**
 * HistoryView — the union of views the history shell can render.
 *
 * list   — summary list of all persisted workflow runs
 * detail — full audit record for one selected run
 */
export type HistoryView = {
    readonly kind: "list";
    readonly summaries: readonly WorkflowHistorySummary[];
} | {
    readonly kind: "detail";
    readonly record: WorkflowAuditRecord;
};
/**
 * Render a HistoryView into a ShellFrame.
 *
 * Pure. No I/O. No store reads.
 * Follows the same ShellFrame contract as renderCursorFrame, renderClaudeFrame,
 * and renderWorkflowFrame — prompt.kind ("confirm" or "choose") is the only
 * discriminant the CLI loop needs.
 */
export declare function renderHistoryFrame(view: HistoryView): ShellFrame;
//# sourceMappingURL=history-render.d.ts.map