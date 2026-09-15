/**
 * Phase 9A + 9D + 10C: Product Shell — public API.
 *
 * ── What this module exports ──────────────────────────────────────────────────
 *
 *   types    — ShellFrame, ShellPrompt, ShellRuntime
 *   render   — renderCursorFrame, renderClaudeFrame, renderWorkflowFrame,
 *              renderHistoryFrame (Phase 10C)
 *   advance  — advanceCursorOnConfirm, advanceCursorOnChoice,
 *              advanceClaudeOnConfirm, advanceClaudeOnChoice (Phase 9A)
 *              advanceWorkflowOnConfirm, advanceWorkflowOnChoice (Phase 9D)
 *   defaults — DEFAULT_CURSOR_POLICY, DEFAULT_CLAUDE_OCD_POLICY,
 *              DEFAULT_CLAUDE_TOOL_POLICY, DEFAULT_STORE_DIR,
 *              resolveStoreDir, DEFAULT_WORKFLOW_POLICIES
 *
 * ── What is NOT exported ──────────────────────────────────────────────────────
 *
 *   The CLI main loop (src/shell/cli/main.ts) — it has I/O and is not
 *   a library concern. It imports from this module.
 *
 * ── WS6 guarantee ─────────────────────────────────────────────────────────────
 *
 *   All render functions return the same ShellFrame contract.
 *   A generic shell loop can drive cursor, claude, workflow, AND history frames
 *   without special-casing any runtime or view kind.
 *   Prompt kind ("confirm" or "choose") is the only discriminant needed.
 *
 * See: docs/phase-9a-baseline.md
 *      docs/phase-9d-baseline.md
 *      docs/phase-10c-baseline.md
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ShellRuntime, ShellFrame, ShellPrompt } from "./types.js";

// ─── Rendering ────────────────────────────────────────────────────────────────

export { renderCursorFrame, renderClaudeFrame } from "./render.js";

// ─── Cursor advance functions ─────────────────────────────────────────────────

export {
  advanceCursorOnConfirm,
  advanceCursorOnChoice,
} from "./cursor-shell.js";

// ─── Claude advance functions ─────────────────────────────────────────────────

export {
  advanceClaudeOnConfirm,
  advanceClaudeOnChoice,
} from "./claude-shell.js";

// ─── Workflow render (Phase 9D) ───────────────────────────────────────────────

export { renderWorkflowFrame } from "./workflow-render.js";

// ─── History render (Phase 10C) ───────────────────────────────────────────────

export type { HistoryView } from "./history-render.js";
export { renderHistoryFrame } from "./history-render.js";

// ─── Workflow advance functions (Phase 9D) ────────────────────────────────────

export type { WorkflowShellPolicies } from "./workflow-shell.js";

export {
  advanceWorkflowOnConfirm,
  advanceWorkflowOnChoice,
} from "./workflow-shell.js";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export {
  DEFAULT_CURSOR_POLICY,
  DEFAULT_CLAUDE_OCD_POLICY,
  DEFAULT_CLAUDE_TOOL_POLICY,
  DEFAULT_STORE_DIR,
  resolveStoreDir,
} from "./defaults.js";

export {
  DEFAULT_WORKFLOW_POLICIES,
  workflowPoliciesForRoot,
  drainRunning,
} from "./workflow-defaults.js";
