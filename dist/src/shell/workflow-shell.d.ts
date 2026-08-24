/**
 * Phase 9D: Workflow shell advance functions.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure (or async-pure) functions that map a user answer + current WorkflowRun
 *   → next WorkflowRun. These are the seam between the I/O layer and the
 *   WorkflowCoordinator API.
 *
 * ── What these functions do ───────────────────────────────────────────────────
 *
 *   advanceWorkflowOnConfirm  — handles "confirm" prompt answers (y/n).
 *     Valid from: task_ready, task_conflict.
 *     yes: [acceptConflict if needed] → confirmWorkflowTask(true) → deliver
 *          → if running: advanceWorkflow (auto-advance to next task)
 *     no:  confirmWorkflowTask(false) → task_failed
 *
 *   advanceWorkflowOnChoice  — handles "choose" prompt answers (1-N).
 *     Valid from: task_scope, task_failed.
 *     task_scope:  answerWorkflowScope(idx) → deliver → if running: advanceWorkflow
 *     task_failed: applyFailureAction(action) → if running: advanceWorkflow
 *
 * ── The approve+deliver collapse ─────────────────────────────────────────────
 *
 *   The coordinator keeps confirmWorkflowTask and deliverWorkflowTask separate
 *   (W2 — coordinator never approves on behalf of H). The shell collapses them
 *   into one user action because "I approved it, now run it" is the correct
 *   product-shell semantic. task_approved is an internal transition, not shown.
 *
 *   This is identical to what Phase 9A did for cursor-shell / claude-shell.
 *
 * ── What these functions are NOT ──────────────────────────────────────────────
 *
 *   WS2: NOT authority layers — all decisions are delegated to coordinator functions.
 *        The shell never calls approve() or deliver() directly on sessions.
 *        It only calls coordinator functions (confirmWorkflowTask, deliverWorkflowTask).
 *   NOT renderers — rendering is in workflow-render.ts.
 *   NOT stateful — return new WorkflowRun; do not mutate.
 *
 * ── Phase 6 side-effect note ──────────────────────────────────────────────────
 *
 *   advanceWorkflowOnConfirm performs ONE best-effort filesystem side-effect at
 *   the reviewing -> start approval moment: it appends an approval-provenance
 *   record (recordRunApprovalProvenance below). This is sanctioned by
 *   src/constitution/approval-record.ts, which designates the shell/server as the
 *   durable persistence callers (the coordinator stays pure). It carries zero
 *   authority — see recordRunApprovalProvenance for the full boundary argument.
 *
 * See: docs/phase-9d-baseline.md, docs/reports/phase6-production-approval-provenance-finish-v1.md
 */
import type { WorkflowRun, WorkflowPlugins } from "../workflow/types.js";
import type { CursorOCDPolicy } from "../cursor/types.js";
import type { ClaudeOCDPolicy } from "../claude/artifact-mapper.js";
import type { ClaudeToolPolicy } from "../claude/types.js";
import type { ClaudeGateDeps } from "../claude/delivery-gate.js";
/**
 * WorkflowShellPolicies — all OCD + tool policies needed by advanceWorkflow.
 *
 * Grouped here to keep advance function signatures clean.
 * Mirrors Phase 9A's per-function policy params, grouped for the workflow context.
 */
export type WorkflowShellPolicies = {
    readonly cursorPolicy: CursorOCDPolicy;
    readonly claudeOCDPolicy: ClaudeOCDPolicy;
    readonly claudeToolPolicy: ClaudeToolPolicy;
    /** P6 V1 — workspace the FS reality probe reads after delivery. */
    readonly workspaceRoot?: string;
};
/**
 * Advance the workflow based on a yes/no answer to the current confirm prompt.
 *
 * Called when `renderWorkflowFrame(run).prompt.kind === "confirm"`.
 * Valid from "task_ready" and "task_conflict".
 *
 * yes: if task_conflict → acceptWorkflowConflict first.
 *      then confirmWorkflowTask(true) → task_approved.
 *      then deliverWorkflowTask → final outcome.
 *      if outcome === "running" → advanceWorkflow (auto-advance to next task).
 *
 * no:  confirmWorkflowTask(false) → task_failed (outcome: "rejected").
 *
 * WS2: this function never calls approve() or deliver() on sessions directly.
 *      All decisions go through coordinator functions.
 *
 * @param run      Current workflow run (must be task_ready or task_conflict).
 * @param yes      true = H approved; false = H rejected.
 * @param plugins  Runtime plugins (coordinator picks by session runtime).
 * @param storeDir UCP store directory.
 * @param policies OCD and tool policies for advanceWorkflow.
 * @param deps     Optional Claude gate dependencies (for test injection).
 */
export type AdvisoryConfirmResolution = {
    readonly relation: "proceed_despite_model_position" | "retire_model_position";
    readonly resolvingEvidenceIds?: readonly string[];
    readonly authorityEvidenceStatus?: "portal_signed_verified" | "self_asserted";
    readonly authorityDecisionId?: string;
    readonly mappedRelations?: readonly {
        readonly modelPositionId: string;
        readonly positionHash: string;
        readonly evidenceBasisId: string;
        readonly evidenceBasisHash: string;
    }[];
};
export declare function advanceWorkflowOnConfirm(run: WorkflowRun, yes: boolean, plugins: WorkflowPlugins, storeDir: string, policies: WorkflowShellPolicies, deps?: ClaudeGateDeps, advisoryResolution?: AdvisoryConfirmResolution): Promise<WorkflowRun>;
/**
 * Advance the workflow based on a numbered choice.
 *
 * Called when `renderWorkflowFrame(run).prompt.kind === "choose"`.
 * Valid from "task_scope" and "task_failed".
 *
 * From task_scope:
 *   choiceIdx (1-N) selects a candidate file.
 *   answerWorkflowScope → task_approved → deliver → if running: advanceWorkflow.
 *   Out-of-range index → returns run unchanged (re-prompt).
 *
 * From task_failed:
 *   choiceIdx 1 = "stop"  → applyFailureAction("stop")  → stopped.
 *   choiceIdx 2 = "skip"  → applyFailureAction("skip")  → running/completed.
 *   choiceIdx 3 = "retry" → applyFailureAction("retry") → running (if within limit).
 *   If applyFailureAction("retry") returns the same run (max retries), re-prompt.
 *   If action produces "running" → advanceWorkflow.
 *
 * WS3: The "stop/skip/retry" choice is never a confirm — it cannot imply a default.
 *
 * @param run      Current workflow run (must be task_scope or task_failed).
 * @param choiceIdx 1-based index into the choices shown by renderWorkflowFrame.
 * @param plugins  Runtime plugins.
 * @param storeDir UCP store directory.
 * @param policies OCD and tool policies for advanceWorkflow.
 * @param deps     Optional Claude gate dependencies.
 */
export declare function advanceWorkflowOnChoice(run: WorkflowRun, choiceIdx: number, plugins: WorkflowPlugins, storeDir: string, policies: WorkflowShellPolicies, deps?: ClaudeGateDeps): Promise<WorkflowRun>;
//# sourceMappingURL=workflow-shell.d.ts.map