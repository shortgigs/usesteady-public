import type { WorkflowRun } from "../../workflow/types.js";
export type WorkflowTerminalOutcome = "completed" | "stopped_by_user" | "failed_explicit";
export type WorkflowTerminalRecord = {
    outcome: WorkflowTerminalOutcome;
    exitCode: number;
    message: string;
};
export type ConfirmInput = "yes" | "no" | "exit" | "invalid";
export declare function parseConfirmInput(answer: string): ConfirmInput;
/**
 * classifyWorkflowTerminalOutcome — single source of truth for terminal
 * outcome classification. Callers must never gate `explicitFailureReason`
 * on phase: a captured tool/adapter failure is the whole point of the
 * field and must reach this classifier verbatim.
 *
 * Load-bearing invariant (Stabilization P0, PR-1):
 *
 *   `explicitFailureReason` strictly dominates `phase`.
 *
 * If a failure reason was captured, the outcome is always
 * `failed_explicit`, regardless of what `phase` happens to be. This is
 * the truthful-reporting rule: when the tool fails, the CLI must never
 * blame the user. A phase of "stopped" only means "the workflow stopped
 * executing"; it does not tell us *why*. The "why" lives in
 * `explicitFailureReason`.
 *
 * Call sites must therefore pass the captured failure reason through
 * unconditionally. Nulling it when `phase === "stopped"` re-introduces
 * the STOPPED_BY_USER misclassification that PR-1 exists to eliminate.
 *
 * Decision table:
 *
 *   explicitFailureReason  phase           → outcome
 *   ─────────────────────  ──────────────    ────────────────
 *   non-null               *               → failed_explicit
 *   null                   "completed"     → completed
 *   null                   "stopped"       → stopped_by_user
 *   null                   any other       → failed_explicit
 */
export declare function classifyWorkflowTerminalOutcome(params: {
    phase: WorkflowRun["phase"];
    explicitFailureReason: string | null;
}): WorkflowTerminalRecord;
//# sourceMappingURL=workflow-terminal.d.ts.map