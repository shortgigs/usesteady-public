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

import { advanceWorkflow, bindEffectiveResourceOnReady } from "../workflow/coordinator.js";
import type { WorkflowRun } from "../workflow/types.js";
import { DEFAULT_CURSOR_POLICY, DEFAULT_CLAUDE_OCD_POLICY, DEFAULT_CLAUDE_TOOL_POLICY } from "./defaults.js";
import type { WorkflowShellPolicies } from "./workflow-shell.js";

/**
 * Default WorkflowShellPolicies for CLI use.
 *
 * Wraps the three existing shell defaults into the grouped type expected by
 * advanceWorkflowOnConfirm and advanceWorkflowOnChoice.
 *
 * This object has no top-level workspaceRoot. cursorPolicy.workspaceRoot is
 * process.cwd() at module load. Callers that have a selected operator
 * workspace MUST use workflowPoliciesForRoot() instead of this object.
 * Do not mutate this export.
 */
export const DEFAULT_WORKFLOW_POLICIES: WorkflowShellPolicies = {
  cursorPolicy:     DEFAULT_CURSOR_POLICY,
  claudeOCDPolicy:  DEFAULT_CLAUDE_OCD_POLICY,
  claudeToolPolicy: DEFAULT_CLAUDE_TOOL_POLICY,
};

/**
 * Per-run policies for a selected operator workspace.
 *
 * Copies cursor policy and sets BOTH top-level workspaceRoot and
 * cursorPolicy.workspaceRoot to `workspaceRoot`. Does not mutate
 * DEFAULT_WORKFLOW_POLICIES or DEFAULT_CURSOR_POLICY.
 */
export function workflowPoliciesForRoot(workspaceRoot: string): WorkflowShellPolicies {
  return {
    cursorPolicy: {
      ...DEFAULT_CURSOR_POLICY,
      workspaceRoot,
    },
    claudeOCDPolicy: DEFAULT_CLAUDE_OCD_POLICY,
    claudeToolPolicy: DEFAULT_CLAUDE_TOOL_POLICY,
    workspaceRoot,
  };
}

/**
 * Drain transient `running` and bind against the selected root.
 * Transport only: no approval skip, no auto-confirm.
 */
export function drainRunning(run: WorkflowRun, workspaceRoot: string): WorkflowRun {
  const policies = workflowPoliciesForRoot(workspaceRoot);
  let next = run;
  while (next.phase === "running") {
    const advanced = advanceWorkflow(
      next,
      policies.cursorPolicy,
      policies.claudeOCDPolicy,
      policies.claudeToolPolicy,
    );
    if (advanced === next) break;
    next = advanced;
  }
  return bindEffectiveResourceOnReady(next, policies.workspaceRoot);
}
