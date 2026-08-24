/**
 * Phase 9C: Workflow coordinator.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Sequences CursorProductSession and ClaudeProductSession instances,
 *   one at a time, through a human-authored list of task specs.
 *
 * ── What this is NOT (W1) ─────────────────────────────────────────────────────
 *
 *   NOT authority — calls session functions; makes no decisions.
 *   NOT a planner — task specs are fixed at definition time; none are derived.
 *   NOT a retry engine — retry creates a new session; H re-approves every time.
 *   NOT a batch approver — each session requires explicit H approval (W2).
 *   NOT stateful — all functions return new WorkflowRun objects.
 *
 * ── Function contract ─────────────────────────────────────────────────────────
 *
 *   createWorkflowRun(spec)               → "reviewing"
 *   startWorkflow(run, ...)              → "task_ready" | "task_conflict" | "completed"
 *   cancelWorkflow(run)                  → "stopped" (no session created)
 *   advanceWorkflow(run, ...)             → "task_ready" | "task_conflict" | "completed"
 *   acceptWorkflowConflict(run)           → "task_ready"
 *   confirmWorkflowTask(run, yes)         → "task_approved" | "task_failed"
 *   deliverWorkflowTask(run, ...)         → "running" | "task_scope" | "task_failed"
 *   answerWorkflowScope(run, idx, ...)    → "task_approved" (→ call deliverWorkflowTask)
 *   applyFailureAction(run, action, ...)  → "running" | "stopped"
 *
 * ── Shell loop ─────────────────────────────────────────────────────────────────
 *
 *   run = createWorkflowRun(spec)            // → "reviewing"
 *   // (H confirms pre-flight list)
 *   run = startWorkflow(run, ...)           // → "task_ready" | "task_conflict"
 *   while (!isWorkflowTerminal(run)):
 *     if "task_conflict": run = acceptWorkflowConflict(run)  // or reject
 *     if "task_ready":    run = confirmWorkflowTask(run, yes)
 *     if "task_approved": run = await deliverWorkflowTask(run, ...)
 *     if "task_scope":    run = await answerWorkflowScope(run, idx, ...)
 *                         run = await deliverWorkflowTask(run, ...)
 *     if "task_failed":   run = applyFailureAction(run, action)
 *     if "running":       run = advanceWorkflow(run, ...)
 *
 * ── Authority invariants (W1–W8) ──────────────────────────────────────────────
 *
 *   W2: confirmWorkflowTask(yes) → calls approve() only. deliverWorkflowTask
 *       is a separate explicit call. The coordinator never auto-delivers.
 *   W3: applyFailureAction("retry") creates a new session; never resumes.
 *   W6: applyOCDOverride() adds to prohibited globs; never removes.
 *   W7: task spec inputs are read-only; never modified after createWorkflowRun.
 *   W8: runtime is taken from task spec; never derived or converted.
 *
 * See: docs/phase-9b-workflow-design.md
 */
import type { CursorOCDPolicy } from "../cursor/types.js";
import type { ClaudeOCDPolicy } from "../claude/artifact-mapper.js";
import type { ClaudeToolPolicy } from "../claude/types.js";
import type { ClaudeGateDeps } from "../claude/delivery-gate.js";
import type { WorkflowSpec, WorkflowRun, WorkflowPlugins, FsChange } from "./types.js";
import type { WorkflowRunPayload } from "../ucp/types.js";
import type { RealityProbe } from "../governed-decision/stages/observation.js";
import type { RepositoryProvenanceFact } from "../constitution/index.js";
/**
 * Build an FsChange from a structured WorkflowTaskSpec (when operationType is set).
 * Returns undefined if the spec fields are incomplete for the given operation.
 */
export declare function buildFsChangeFromSpec(spec: import("./types.js").WorkflowTaskSpec): FsChange | undefined;
export declare function isDeliverableTaskSpec(spec: import("./types.js").WorkflowTaskSpec): boolean;
/**
 * Deterministic workflow run id from the spec (`name` + `tasks`). Exported
 * (Phase 5) so the internal SDK can derive the SAME id its captured
 * ApprovalRecord must bind to — i.e. the id `createWorkflowRun` will assign when
 * the host later executes the SDK's canonical spec. Pure, zero-authority,
 * visibility-only export; behavior unchanged.
 */
export declare function deriveWorkflowRunId(spec: WorkflowSpec): string;
/**
 * Create a new WorkflowRun from a spec.
 *
 * The run begins in "reviewing" phase (Phase 11D / WF-R1).
 * No session is created until H explicitly starts the workflow via startWorkflow().
 *
 * WF-R2: currentSession is absent in "reviewing".
 *
 * @param opts.mode             "break_glass" to skip per-step human confirm (BG-1).
 * @param opts.breakGlassReason Required when mode is "break_glass" (BG-4).
 *                              Recorded in audit permanently (BG-3).
 */
export declare function createWorkflowRun(spec: WorkflowSpec, opts?: {
    mode?: "normal" | "break_glass";
    breakGlassReason?: string;
    /**
     * Materialization increment 1: the captured Repository provenance to fold
     * into the Decision Basis fingerprint at approval time. Omitted (or null)
     * keeps the Phase-1 spec-only basis — byte-identical to prior behavior. When
     * supplied, the re-check at deliverWorkflowTask MUST be passed the
     * current provenance via its `constitution` argument, or the fingerprints
     * will not reconcile (intended: that is the lifecycle guard doing its job).
     */
    repositoryProvenance?: RepositoryProvenanceFact | null;
}): WorkflowRun;
/**
 * Confirm the pre-flight review and start executing the first task.
 *
 * WF-R3: the only path out of "reviewing" into execution.
 *
 * Transitions "reviewing" → "idle" → immediately calls advanceWorkflow to
 * prepare the first task. Returns the same result advanceWorkflow would:
 * "task_ready" | "task_conflict" | "completed" (if all tasks auto-skip).
 *
 * Valid from "reviewing" only; no-op from any other phase.
 */
export declare function startWorkflow(run: WorkflowRun, cursorPolicy: CursorOCDPolicy, claudeOCDPolicy: ClaudeOCDPolicy, claudeToolPolicy: ClaudeToolPolicy): WorkflowRun;
/**
 * Cancel the workflow at the pre-flight stage.
 *
 * H declined to start. No session was ever created (WF-R1).
 * Transitions "reviewing" → "stopped" cleanly.
 *
 * Valid from "reviewing" only; no-op from any other phase.
 */
export declare function cancelWorkflow(run: WorkflowRun): WorkflowRun;
export declare function isWorkflowTerminal(run: WorkflowRun): boolean;
/**
 * Advance the workflow to the next task.
 *
 * Called when phase is "idle" or "running".
 *
 * Creates a new session for the current task spec, submits the task input,
 * and transitions to "task_ready", "task_conflict", or "completed".
 *
 * Auto-skips tasks where intake returns a non-execute mode ("skipped_by_intake").
 * This is the V1 default policy for non-execute inputs (see Phase 9B design).
 *
 * @param cursorPolicy    Workspace Cursor OCD policy (workflow override is applied internally).
 * @param claudeOCDPolicy Workspace Claude OCD policy (workflow override is applied internally).
 * @param claudeToolPolicy Claude tool policy.
 */
export declare function advanceWorkflow(run: WorkflowRun, cursorPolicy: CursorOCDPolicy, claudeOCDPolicy: ClaudeOCDPolicy, claudeToolPolicy: ClaudeToolPolicy): WorkflowRun;
/**
 * Accept the OCD conflict on the current task.
 *
 * Valid from "task_conflict" only.
 * Transitions to "task_ready".
 */
export declare function acceptWorkflowConflict(run: WorkflowRun): WorkflowRun;
/**
 * Confirm (approve) or reject the current prepared task.
 *
 * Valid from "task_ready" and "task_conflict" (rejection path).
 *
 * yes=true  → calls approve() / approveClaude() → "task_approved"
 * yes=false → calls reject() / rejectClaude()   → "task_failed" (outcome: "rejected")
 *
 * ── Proof W2 (never approves on behalf of H) ────────────────────────────────
 *
 *   This function calls approve() exactly once when yes=true.
 *   It does NOT call deliver() or deliverClaude().
 *   The session transitions to "approved", not "accepted".
 *   deliverWorkflowTask() is the separate, explicit delivery step.
 */
export declare function confirmWorkflowTask(run: WorkflowRun, yes: boolean): WorkflowRun;
/**
 * Deliver the current approved task to its runtime.
 *
 * Valid from "task_approved" only.
 *
 * Outcome:
 *   accepted    → record outcome, increment currentIndex → "running"
 *   scope_question → "task_scope"
 *   advisory    → PARK in "task_advisory" (P3 Phase 2 — no execution, no advance)
 *   exec_error / blocked → "task_failed"
 *
 * @param plugins  WorkflowPlugins — coordinator picks the right one by runtime (W8 / Proof 3).
 * @param storeDir UCP store directory.
 * @param deps     Optional gate dependencies (for test injection, Claude only).
 */
export declare function deliverWorkflowTask(run: WorkflowRun, plugins: WorkflowPlugins, storeDir: string, deps?: ClaudeGateDeps, constitution?: {
    /**
     * The repository provenance captured NOW, at the execution side-effect
     * surface. Re-folded into the basis and compared to the fingerprint recorded
     * at approval. If the repository moved since approval (different commit, went
     * dirty) the fingerprints diverge and execution fails closed — even when the
     * spec hash is still valid. Must mirror the provenance supplied to
     * createWorkflowRun; omitted (or null) keeps the spec-only basis.
     */
    repositoryProvenance?: RepositoryProvenanceFact | null;
    /** P6 V1 — workspace the existing FS reality probe reads. */
    workspaceRoot?: string;
    /** P6 V1 — injected probe (tests). When absent, `makeFsRealityProbe(workspaceRoot)`. */
    realityProbe?: RealityProbe;
}): Promise<WorkflowRun>;
/**
 * Answer a scope clarification question for the current task.
 *
 * Valid from "task_scope" only.
 * Transitions to "task_approved" so the caller can call deliverWorkflowTask again.
 *
 * @param choiceIdx 1-based index into the scope candidates.
 *                  Out-of-range → returns state unchanged.
 */
export declare function answerWorkflowScope(run: WorkflowRun, choiceIdx: number): WorkflowRun;
/**
 * Resolve a parked model advisory for the current task.
 *
 * Valid from "task_advisory" only (claude runtime — advisories exist only on
 * the claude seam). No-op from every other phase: a terminal refusal can never
 * enter the supersession path, and a plain task_ready approval is NEVER a
 * supersession.
 *
 *   proceed=true  → the human explicitly chose to proceed despite the model
 *                   position(s). The positions move to the session's cumulative
 *                   supersededAdvisories and the run returns to "task_approved"
 *                   so the caller re-delivers via deliverWorkflowTask.
 *   proceed=false → the human declined to proceed. This is NOT an override of
 *                   the model and NOT a failure of the task's own execution —
 *                   it is recorded as "rejected" via the existing reject path.
 *
 * The durable WHO/WHICH/WHAT binding is the Portal-signed authority assertion
 * (when the pending-approval bridge is enabled); a local proceed is
 * self-asserted and never mints portal_signed_verified supersession evidence.
 */
export declare function resolveWorkflowAdvisory(run: WorkflowRun, proceed: boolean): WorkflowRun;
export type RetireWorkflowAdvisoryInput = {
    readonly resolvingEvidenceIds: readonly string[];
    readonly authorityEvidenceStatus: "portal_signed_verified" | "self_asserted";
    readonly authorityDecisionId?: string;
    readonly mappedRelations?: readonly {
        readonly modelPositionId: string;
        readonly positionHash: string;
        readonly evidenceBasisId: string;
        readonly evidenceBasisHash: string;
    }[];
};
/**
 * Retire the parked model advisory on named evidence (P5 V1).
 *
 * Distinct from resolveWorkflowAdvisory(proceed=true) — that is proceed-despite.
 * Empty evidence, wrong objection, or a non-advisory phase leaves the run
 * unchanged (refuse). Original advisory envelopes are never rewritten.
 */
export declare function retireWorkflowAdvisory(run: WorkflowRun, input: RetireWorkflowAdvisoryInput, storeDir?: string): WorkflowRun;
/**
 * Apply a failure action to the current failed task.
 *
 * Valid from "task_failed" only.
 *
 * Actions:
 *   stop  → "stopped" (terminal)
 *   skip  → record as "skipped", advance currentIndex → "running"
 *   retry → if retryCount < maxRetries: increment retryCount, reset session → "running"
 *            if retryCount >= maxRetries: returns state unchanged (stop/skip only)
 *
 * W3: retry creates a new session via advanceWorkflow; no session is re-opened.
 *
 * @returns Next WorkflowRun. Caller must call advanceWorkflow() after "running".
 */
export declare function applyFailureAction(run: WorkflowRun, action: "stop" | "skip" | "retry"): WorkflowRun;
/**
 * buildWorkflowRunPayload — produce the UCP payload for ucp.workflow_run.v1.
 *
 * Called when the workflow reaches "completed" or "stopped" (W5).
 * Not called for in-progress runs.
 *
 * @throws {Error} If run is not in a terminal phase.
 */
export declare function buildWorkflowRunPayload(run: WorkflowRun): WorkflowRunPayload;
/**
 * persistWorkflowRun — build a ucp.workflow_run.v1 envelope and persist it.
 *
 * This is fire-and-forget (uses persistEnvelope, not persistEnvelopeOrThrow).
 * A persistence failure must NOT block the shell from rendering a terminal
 * state to the user. The UCP record is an audit artifact, not a gate.
 *
 * @throws {Error} If run is not terminal. Call only after isWorkflowTerminal(run).
 */
export declare function persistWorkflowRun(run: WorkflowRun, storeDir: string): void;
//# sourceMappingURL=coordinator.d.ts.map