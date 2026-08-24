/**
 * Phase 9D: Workflow shell default policies.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Sensible defaults for driving the WorkflowCoordinator from the CLI shell.
 *   Groups all three policy objects into one WorkflowShellPolicies value so
 *   the CLI main loop doesn't have to build them inline.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────────
 *
 *   Production policy config (workspace-specific).
 *   Workflow OCD overrides (spec-level, not defaults).
 */
import { DEFAULT_CURSOR_POLICY, DEFAULT_CLAUDE_OCD_POLICY, DEFAULT_CLAUDE_TOOL_POLICY } from "./defaults.js";
/**
 * Default WorkflowShellPolicies for CLI use.
 *
 * Wraps the three existing shell defaults into the grouped type expected by
 * advanceWorkflowOnConfirm and advanceWorkflowOnChoice.
 */
export const DEFAULT_WORKFLOW_POLICIES = {
    cursorPolicy: DEFAULT_CURSOR_POLICY,
    claudeOCDPolicy: DEFAULT_CLAUDE_OCD_POLICY,
    claudeToolPolicy: DEFAULT_CLAUDE_TOOL_POLICY,
};
//# sourceMappingURL=workflow-defaults.js.map