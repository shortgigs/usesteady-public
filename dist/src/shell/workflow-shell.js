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
import { startWorkflow, cancelWorkflow, acceptWorkflowConflict, confirmWorkflowTask, deliverWorkflowTask, answerWorkflowScope, resolveWorkflowAdvisory, retireWorkflowAdvisory, applyFailureAction, advanceWorkflow, isWorkflowTerminal, } from "../workflow/coordinator.js";
import { recordApprovalBasis } from "../constitution/index.js";
// ─── Internal: production approval provenance (Phase 6, Path B) ───────────────
/**
 * Persist the run's spec-only Decision Basis fingerprint WITH the approval, at
 * the single moment H approves starting a governed run (reviewing -> start).
 *
 * This is USESTEADY_CONSTITUTION_V1 Article VI step 3 materialized in PRODUCTION:
 * `createWorkflowRun` already computed the fingerprint and carried it on the run
 * (provenance, INV-TMP-1); this writes it durably so the decision is
 * recertifiable later. Both surfaces funnel here — `server.ts` and `main.ts`
 * both call `advanceWorkflowOnConfirm` — so one write covers Web and CLI.
 *
 * Zero authority, by construction:
 *   - The approval gate is unchanged (H still approved before this runs).
 *   - The execution gate is unchanged (`deliverWorkflowTask` re-verifies the
 *     SAME spec-only fingerprint via `verifyDecisionBasisFingerprint`).
 *   - The record stores the run's OWN fingerprint, so it can never newly trip
 *     `abortOnDecisionBasisMismatch` (locked by
 *     tests/constitution/approval-provenance-binding.test.ts).
 *   - Repository enrichment is deferred (Phase 6 D2): spec-only basis only.
 *
 * Best-effort: provenance is observability, not authority. A write failure must
 * never block an approved run, so it is swallowed.
 *
 * Edge semantics (both intentional, see D3 in the finish report):
 *   - A run that auto-skips every task and reaches "completed" at start still
 *     records provenance — H DID approve starting the run.
 *   - Concurrent duplicate confirms on a still-"reviewing" run could append two
 *     records. Harmless: the store is append-only, the gate never reads it, and
 *     loadApprovalBasis returns the latest. No lock is taken here.
 */
function recordRunApprovalProvenance(run, storeDir) {
    // Only a successfully-started run (out of "reviewing") carries an approval.
    if (run.phase === "reviewing")
        return;
    const fingerprint = run.decisionBasisFingerprint;
    if (!fingerprint)
        return;
    if (storeDir.trim().length === 0)
        return;
    try {
        recordApprovalBasis({
            workflowRunId: run.workflowRunId,
            decisionBasisFingerprint: fingerprint,
            capturedAt: new Date().toISOString(),
        }, storeDir);
    }
    catch {
        // Swallow: the execution gate still protects the run; provenance is additive.
    }
}
// ─── Internal: deliver + auto-advance ────────────────────────────────────────
/**
 * Deliver the current approved task and auto-advance when delivery returns "running".
 *
 * The "running" state means delivery succeeded and there are more tasks.
 * The shell advances immediately so the next task is ready for H without an
 * extra prompt round-trip.
 *
 * task_scope and task_failed are surfaced to H as-is (no auto-advance).
 */
async function deliverAndAdvance(run, plugins, storeDir, policies, deps) {
    const delivered = await deliverWorkflowTask(run, plugins, storeDir, deps, policies.workspaceRoot !== undefined
        ? { workspaceRoot: policies.workspaceRoot }
        : undefined);
    // Auto-advance through "running" (between tasks) so the shell loop gets
    // a stable phase (task_ready, task_conflict, task_scope, task_failed,
    // completed, or stopped) rather than needing an extra advanceWorkflow call.
    if (delivered.phase === "running") {
        return advanceWorkflow(delivered, policies.cursorPolicy, policies.claudeOCDPolicy, policies.claudeToolPolicy);
    }
    return delivered;
}
export async function advanceWorkflowOnConfirm(run, yes, plugins, storeDir, policies, deps, advisoryResolution) {
    if (isWorkflowTerminal(run))
        return run;
    // ── reviewing: pre-flight start/cancel ───────────────────────────────────
    // WF-R3: startWorkflow is the only path out of reviewing into execution.
    if (run.phase === "reviewing") {
        if (!yes)
            return cancelWorkflow(run);
        const started = startWorkflow(run, policies.cursorPolicy, policies.claudeOCDPolicy, policies.claudeToolPolicy);
        // Phase 6 (Path B): H just approved starting this run — persist the approval
        // provenance once, here, for both surfaces. Additive and best-effort; the
        // approval/execution gates are unchanged.
        recordRunApprovalProvenance(started, storeDir);
        return started;
    }
    // ── task_advisory: parked on a structured model advisory (P3 Phase 2) ───────
    // The ONLY way forward is an explicit human decision on THIS frame. Note:
    // break_glass (BG-2) intentionally does NOT auto-proceed here — silently
    // superseding a model position under break-glass would misrepresent the
    // record ("human overrode the AI" without a human decision). Under
    // break_glass the advisory frame still prompts; the decision is local and
    // self-asserted, never a portal_signed_verified supersession.
    if (run.phase === "task_advisory") {
        if (yes &&
            advisoryResolution?.relation === "retire_model_position") {
            const ids = advisoryResolution.resolvingEvidenceIds ?? [];
            const retired = retireWorkflowAdvisory(run, {
                resolvingEvidenceIds: ids,
                authorityEvidenceStatus: advisoryResolution.authorityEvidenceStatus ?? "self_asserted",
                ...(advisoryResolution.authorityDecisionId !== undefined
                    ? { authorityDecisionId: advisoryResolution.authorityDecisionId }
                    : {}),
                ...(advisoryResolution.mappedRelations !== undefined
                    ? { mappedRelations: advisoryResolution.mappedRelations }
                    : {}),
            }, storeDir);
            if (retired.phase !== "task_approved") {
                return retired;
            }
            return deliverAndAdvance(retired, plugins, storeDir, policies, deps);
        }
        const resolved = resolveWorkflowAdvisory(run, yes);
        if (!yes || resolved.phase !== "task_approved") {
            return resolved;
        }
        // Proceed-despite-position: re-deliver + auto-advance as usual.
        return deliverAndAdvance(resolved, plugins, storeDir, policies, deps);
    }
    if (run.phase !== "task_ready" && run.phase !== "task_conflict")
        return run;
    // BG-2: break_glass skips per-step human confirm.
    // Same workspace, same runtime, same seam — only the H gate is removed.
    // The audit record still captures every step (BG-3).
    const effectiveYes = run.mode === "break_glass" ? true : yes;
    if (!effectiveYes) {
        // H rejected — transition to task_failed.
        return confirmWorkflowTask(run, false);
    }
    // H approved (or break-glass auto-approved).
    // For task_conflict: accept the conflict first to reach task_ready.
    const ready = run.phase === "task_conflict"
        ? acceptWorkflowConflict(run)
        : run;
    // Approve — transitions to task_approved (internal).
    const approved = confirmWorkflowTask(ready, true);
    // Deliver + auto-advance through "running" if there are more tasks.
    return deliverAndAdvance(approved, plugins, storeDir, policies, deps);
}
// ─── Choice advance (1-N selection) ──────────────────────────────────────────
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
export async function advanceWorkflowOnChoice(run, choiceIdx, plugins, storeDir, policies, deps) {
    if (isWorkflowTerminal(run))
        return run;
    // ── task_scope: file selection ────────────────────────────────────────────
    if (run.phase === "task_scope") {
        const answered = answerWorkflowScope(run, choiceIdx);
        if (answered === run)
            return run; // out-of-range — re-prompt
        // answered is now task_approved — deliver + auto-advance.
        return deliverAndAdvance(answered, plugins, storeDir, policies, deps);
    }
    // ── task_failed: stop / skip / retry ─────────────────────────────────────
    if (run.phase === "task_failed") {
        // Map choice index to action.
        // Choices match what renderWorkflowFrame presents:
        //   1 = "stop", 2 = "skip", 3 = "retry" (when retry is available)
        const actionMap = {
            1: "stop",
            2: "skip",
            3: "retry",
        };
        const action = actionMap[choiceIdx];
        if (!action)
            return run; // out-of-range — re-prompt
        const next = applyFailureAction(run, action);
        if (next === run)
            return run; // retry at max limit — re-prompt
        // If action produced "running", auto-advance to next task.
        if (next.phase === "running") {
            return advanceWorkflow(next, policies.cursorPolicy, policies.claudeOCDPolicy, policies.claudeToolPolicy);
        }
        return next;
    }
    return run;
}
//# sourceMappingURL=workflow-shell.js.map