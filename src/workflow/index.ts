/**
 * Phase 9C / 9F: Workflow — public API.
 *
 * ── What this module exports ──────────────────────────────────────────────────
 *
 *   types       — WorkflowSpec, WorkflowRun, WorkflowTask, WorkflowPlugins, etc.
 *   coordinator — all workflow transition functions + terminal check + persistence
 *
 * ── Consumer pattern ──────────────────────────────────────────────────────────
 *
 *   const run = createWorkflowRun(spec);        // → "reviewing"
 *   run = startWorkflow(run, ...policies);       // → "task_ready" | "task_conflict" | "completed"
 *   // (or: run = cancelWorkflow(run)            // → "stopped")
 *
 *   while (!isWorkflowTerminal(run)) {
 *     if (run.phase === "task_conflict") run = acceptWorkflowConflict(run);
 *     if (run.phase === "task_ready")    run = confirmWorkflowTask(run, H_approved);
 *     if (run.phase === "task_approved") run = await deliverWorkflowTask(run, plugins, storeDir);
 *     if (run.phase === "task_scope")    run = answerWorkflowScope(run, idx);
 *                                        run = await deliverWorkflowTask(run, plugins, storeDir);
 *     if (run.phase === "task_failed")   run = applyFailureAction(run, H_action);
 *     if (run.phase === "running")       run = advanceWorkflow(run, ...policies);
 *   }
 *
 * See: docs/phase-9b-workflow-design.md — design
 *      docs/phase-9c-baseline.md         — implementation freeze
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  WorkflowSpec,
  WorkflowTaskSpec,
  WorkflowOCDOverride,
  WorkflowRunPhase,
  WorkflowCurrentSession,
  WorkflowRun,
  WorkflowTask,
  WorkflowTaskOutcome,
  WorkflowDisplay,
  WorkflowTaskSummaryLine,
  WorkflowPlugins,
} from "./types.js";

export type {
  ExecutorReportKind,
  OutcomeVerification,
  OutcomeVerificationStatus,
} from "./outcome-verification.js";

export {
  reconcileOutcome,
  fsChangeToExecutableOp,
  reconciliationBinds,
} from "./outcome-verification.js";

// ─── Coordinator ──────────────────────────────────────────────────────────────

export {
  createWorkflowRun,
  startWorkflow,
  cancelWorkflow,
  isWorkflowTerminal,
  advanceWorkflow,
  acceptWorkflowConflict,
  confirmWorkflowTask,
  deliverWorkflowTask,
  answerWorkflowScope,
  applyFailureAction,
  buildWorkflowRunPayload,
  persistWorkflowRun,
  isDeliverableTaskSpec,
  deriveWorkflowRunId,
  bindEffectiveResourceOnReady,
} from "./coordinator.js";

export {
  createExecutionInstanceId,
  executionInstanceKey,
  compareExecutionOrder,
} from "./execution-instance.js";

// ─── Spec hash (Row 2: deterministic workflow spec hash validation) ──────────

export {
  computeWorkflowSpecHash,
  verifyWorkflowSpecHash,
} from "./spec-hash.js";

export {
  buildPlanningReviewSpecFromConfirmed,
  isPlanningReviewSpec,
  generateWorkPlanFromConfirmed,
} from "./planning-review-spec.js";

export type {
  WorkPlan,
  WorkPlanTask,
  DeliverableType,
} from "./work-plan-types.js";

export type { WorkflowSpecHashVerification } from "./spec-hash.js";
