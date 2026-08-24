/**
 * Phase 9C: Workflow types.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Defines the data model for multi-session workflows: spec (what H authors
 *   before a run) and run state (what the coordinator manages during execution).
 *
 * ── Design constraints (from Phase 9B) ────────────────────────────────────────
 *
 *   - WorkflowSpec is fixed at creation time. The coordinator never modifies it.
 *   - WorkflowRun is immutable. Every transition returns a new object.
 *   - currentSession carries the live session state between coordinator steps.
 *   - Tasks track per-task outcomes and retry counts.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────────
 *
 *   - Output forwarding between tasks (Phase 9D)
 *   - Parallel execution (Phase 9D+)
 *   - Batch approval (explicitly deferred, W2)
 *   - OCD override that loosens policy (W6)
 *
 * See: docs/phase-9b-workflow-design.md — full design record
 *      docs/phase-9c-baseline.md         — implementation freeze record
 */
import type { CursorSessionState } from "../product/cursor-product-session.js";
import type { ClaudeSessionState } from "../product/claude-product-session.js";
import type { FsChange } from "../understand/interpretation/types.js";
import type { WorkPlan } from "./work-plan-types.js";
import type { OutcomeVerification } from "./outcome-verification.js";
/**
 * WorkflowSpec — the definition H authors before a workflow runs.
 *
 * Fixed at creation time. The coordinator never modifies it.
 */
export type WorkflowSpec = {
    /** Human-readable name for this workflow (e.g., "Refactor auth module"). */
    readonly name: string;
    /** Ordered list of task definitions. Executed sequentially in V1. */
    readonly tasks: readonly WorkflowTaskSpec[];
    /**
     * Runtime to use when not specified per-task.
     * Default: "cursor".
     */
    readonly defaultRuntime?: "cursor" | "claude";
    /**
     * OCD policy override applied to all sessions in this workflow.
     *
     * V1: may only add prohibited globs — cannot remove or replace existing policy.
     * This tightens the workspace policy for this workflow run specifically.
     * Invariant W6: a workflow may never loosen OCD relative to the workspace default.
     */
    readonly ocdOverride?: WorkflowOCDOverride;
    /**
     * Maximum retries per task before only stop/skip are offered to H.
     * Default: 2.
     */
    readonly maxRetries?: number;
    /**
     * Present on planning-review runs: headline shown in ReviewingFrame.
     * Non-execution route — no filesystem changes until a future authorized slice.
     */
    readonly planningReviewHeadline?: string;
    /**
     * USESTEADY_WORKPLAN_GENERATION_V1 — pre-execution work plan artifact.
     * Zero authority; surfaces goal, tasks, and nextAction for operator review.
     */
    readonly workPlan?: WorkPlan;
};
export type WorkflowTaskSpec = {
    /**
     * The input string for this task.
     * Passed verbatim to submit() / submitClaude(). Never modified by the coordinator.
     * Invariant W7: task specs are fixed at definition time.
     */
    readonly input: string;
    /**
     * Runtime override for this specific task.
     * When absent, falls back to WorkflowSpec.defaultRuntime ?? "cursor".
     * Invariant W8: runtime is fixed at spec time; the coordinator never derives it.
     */
    readonly runtime?: "cursor" | "claude";
    /**
     * Human-readable label for display.
     * Falls back to the first 60 chars of input when absent.
     */
    readonly label?: string;
    /**
     * Explicit scope: the files this task may target. (Phase 11D / F9)
     *
     * WF-S1: when present, targetFiles takes precedence over inferred scope.
     * WF-S2: targetFiles may only narrow scope — never widen.
     * WF-S3: if present and delivery returns scope_question, scope is resolved
     *         automatically without prompting H.
     *
     * Must be a non-empty array of strings when provided.
     * Absent = current scope clarification behaviour is unchanged.
     */
    readonly targetFiles?: readonly string[];
    /**
     * Structured filesystem operation type. (P0 — Build From Scratch)
     *
     * When set, the coordinator bypasses the NL intake pipeline and executes
     * the operation directly after H approval. "replace" is the default (existing
     * behaviour when absent).
     *
     * For "write_file": also set `content` with the file content.
     * For "rename": also set `newPath` with the destination path.
     * For "create_dir" / "delete_file": use `targetFiles[0]` as the path.
     */
    readonly operationType?: "replace" | "create_dir" | "write_file" | "rename" | "delete_file" | "append_file" | "prepend_file" | "run_command";
    /** File content for write_file operations. */
    readonly content?: string;
    /** Destination path for rename operations. */
    readonly newPath?: string;
    /** Shell command for run_command operations. */
    readonly command?: string;
    /**
     * Pre-computed replace operands for programmatic callers (--json / batch).
     *
     * When set, the coordinator passes these values directly to submit() as
     * precomputedPc, bypassing parseChange() entirely.  This is safe for
     * from/to values that contain double quotes, newlines, or other characters
     * that would break the text-parsing regex pipeline.
     *
     * Invariant: must only be set when operationType is absent or "replace".
     * The `input` field is still required for intake mode-classification
     * (a safe canonical form is used; it is never parsed for oldValue/newValue).
     */
    readonly structuredReplace?: {
        readonly oldValue: string;
        readonly newValue: string;
        readonly filePath: string;
    };
    /**
     * usesteady-public#45 — the user's explicit replace occurrence directive.
     *
     * Diagnostics / preview only. The coordinator and executor MUST NOT
     * branch on this field; it carries no execution authority. The
     * `structuredReplace` shape (above) is the executable contract.
     *
     * Populated by the IR → SpecTask mapper only when the user explicitly
     * specified an occurrence directive on the input:
     *   - NL surface: always (the M4 normalizer requires an explicit
     *     occurrence clause per §6.6.2 R4, so every successfully-parsed
     *     NL replace carries one).
     *   - JSON / batch surface: only when the public JSON op contains an
     *     `occurrence` field. When absent, this field is undefined and
     *     the legacy no-directive behavior is preserved byte-for-byte.
     *
     * The `feasibility-validator.ts` validate-stage refusal catches "all"
     * and `{ index: N }` before this SpecTask is built, so when the field
     * does reach a built SpecTask its value is "first" only. The field is
     * kept type-wide so future preview / diagnostic surfaces can render
     * the user's directive verbatim regardless of which branch reached
     * them.
     *
     * See `src/input/ir.ts` `requestedOccurrence` JSDoc for the IR-side
     * contract.
     */
    readonly requestedOccurrence?: "first" | "all" | {
        readonly index: number;
    };
    /**
     * USESTEADY_RUNTIME_PLANNING_REVIEW_ROUTING_V1 — non-execution planning step.
     * Coordinator routes to planning_reviewed without intake or session.
     */
    readonly planningReview?: true;
};
/**
 * WorkflowOCDOverride — additional prohibited globs for this workflow run.
 *
 * CANNOT remove or loosen existing prohibited patterns.
 * This is a tighten-only constraint (W6).
 */
export type WorkflowOCDOverride = {
    readonly additionalProhibitedGlobs: readonly string[];
};
export type WorkflowRunPhase = "reviewing" | "idle" | "running" | "task_ready" | "task_conflict" | "task_approved" | "task_scope" | "task_advisory" | "task_failed" | "completed" | "stopped";
/**
 * WorkflowCurrentSession — the live session state for the task being executed.
 *
 * Tagged with runtime so the coordinator can call the correct session functions.
 * Absent when phase is "reviewing", "idle", "running", "completed", or "stopped".
 */
export type WorkflowCurrentSession = {
    readonly runtime: "cursor";
    readonly state: CursorSessionState;
} | {
    readonly runtime: "claude";
    readonly state: ClaudeSessionState;
};
/**
 * WorkflowRun — the complete state of an executing workflow.
 *
 * Immutable. Every coordinator function returns a new WorkflowRun.
 */
export type WorkflowRun = {
    readonly phase: WorkflowRunPhase;
    readonly workflowRunId: string;
    /**
     * Deterministic SHA-256 hex digest of the workflow spec, computed at
     * createWorkflowRun time over a canonical JSON projection of the spec.
     *
     * Re-validated before each execution advancement (advanceWorkflow,
     * deliverWorkflowTask). A mismatch aborts the workflow to "stopped"
     * — it indicates the spec object the coordinator holds is no longer
     * the spec the operator approved at "reviewing" time.
     *
     * Stored in execution metadata only. Not a signature, not a trust
     * anchor, not a network-issued credential — just a local invariant
     * check across the workflow's lifetime.
     *
     * See: src/workflow/spec-hash.ts
     */
    readonly workflowSpecHash: string;
    /**
     * Constitution Materialization V1 — SHA-256 hex of the Decision Basis
     * (USESTEADY_CONSTITUTION_V1 Article VI: fingerprint = hash(Decision Basis)).
     *
     * Recorded at createWorkflowRun time (approval/reviewing) and re-verified at
     * the deliverWorkflowTask side-effect surface (Article V, INV-COMP-2). A
     * mismatch aborts the workflow to "stopped" fail-closed.
     *
     * Optional for backward compatibility: WorkflowRun objects constructed
     * directly (e.g. older tests) without this field skip the basis re-check.
     * Generalizes workflowSpecHash from Proposal-only to the full eight-class
     * Decision Basis.
     *
     * See: src/constitution/
     */
    readonly decisionBasisFingerprint?: string;
    readonly spec: WorkflowSpec;
    readonly tasks: readonly WorkflowTask[];
    /** Index into spec.tasks for the currently active task. */
    readonly currentIndex: number;
    /** Live session state for the current task. Absent between tasks. */
    readonly currentSession?: WorkflowCurrentSession;
    /**
     * Active filesystem operation. Set instead of currentSession for FS op tasks.
     * The coordinator executes this directly on confirmation — no session needed.
     */
    readonly currentFsOp?: FsChange;
    /** Display fields for the product shell. */
    readonly display: WorkflowDisplay;
    /**
     * Break-glass mode — declared at workflow creation time, never changed mid-run.
     *
     * BG-1: mode is fixed at createWorkflowRun time. Cannot be changed mid-run.
     * BG-2: break_glass skips per-step human confirm only. All other constraints hold:
     *        same workspace limits, same runtime, same seam, same audit record.
     * BG-3: break_glass runs are permanently marked in the audit record.
     * BG-4: breakGlassReason is required when mode is "break_glass".
     *
     * Absent or "normal" = standard approval flow.
     */
    readonly mode?: "normal" | "break_glass";
    readonly breakGlassReason?: string;
    /**
     * Output of the most recent run_command task (if any).
     *
     * Used by CLI --output json to surface deterministic command output for
     * machine callers without affecting non-command workflows.
     */
    readonly lastCommandResult?: {
        readonly stdout: string;
        readonly stderr: string;
        readonly exitCode: number;
    };
};
export type WorkflowTask = {
    readonly index: number;
    readonly spec: WorkflowTaskSpec;
    readonly outcome: WorkflowTaskOutcome;
    readonly retryCount: number;
    /** UCP provenance IDs set when a session runs for this task. */
    readonly intentId?: string;
    readonly responseId?: string;
    /**
     * Issue #42 -- OCD warning vs success reporting alignment.
     *
     * Number of OCD conflicts H accepted along this task's path to
     * delivery. A non-zero value means the user saw a `WARNING - OCD
     * conflict detected (non-blocking)` frame and answered yes (or
     * was auto-accepted under `--yes`). The conflict is intentionally
     * non-blocking by the OCD evaluator's design; the counter exists
     * purely so the end-of-run summary can ACKNOWLEDGE the warning
     * the user saw instead of reporting "Completed successfully" with
     * no mention of it. Without this counter the final outcome
     * silently contradicts what the user just witnessed.
     *
     * Optional + missing-means-zero so existing serialised task
     * snapshots remain valid.
     */
    readonly conflictsAccepted?: number;
    /**
     * P3 Phase 2 — content-addressed model position ids (modelPositionId) that
     * an authorized human explicitly superseded before this task executed.
     *
     * Set at delivery-acceptance time from the session's supersededAdvisories.
     * The referenced ucp.model_advisory.v1 envelopes hold the original model
     * positions unchanged; this field records the durable relation
     * "this action ran after the human proceeded despite these positions".
     * Absent when no supersession occurred.
     */
    readonly supersededPositionIds?: readonly string[];
    /**
     * P5 V1 — content-addressed model position ids an authorized human retired
     * on named evidence before this task executed. Distinct from
     * supersededPositionIds (proceed-despite). Present only when a retirement
     * relation exists. The referenced advisory envelopes are never altered.
     */
    readonly retiredPositionIds?: readonly string[];
    /**
     * P6 V1 — independent outcome verification, distinct from `outcome`.
     * `outcome: "accepted"` is the executor/delivery report only.
     * Absent when no delivery has occurred.
     */
    readonly outcomeVerification?: OutcomeVerification;
};
export type WorkflowTaskOutcome = "pending" | "accepted" | "skipped" | "skipped_by_intake" | "planning_reviewed" | "stopped" | "rejected";
export type WorkflowDisplay = {
    readonly headline: string;
    readonly progress: string;
    readonly currentLabel?: string;
    readonly taskSummary?: readonly WorkflowTaskSummaryLine[];
    readonly failureNote?: string;
    /**
     * Machine-readable failure code propagated from the FS-op layer when a
     * deterministic primitive refuses to execute (e.g. "target_exists",
     * "merge_conflict"). Session-based failures still surface through
     * currentSession.state.executionResult.errorCode — this field is for
     * failures on the FS-op fast path where no session exists.
     */
    readonly errorCode?: string;
};
export type WorkflowTaskSummaryLine = {
    readonly index: number;
    readonly label: string;
    readonly outcome: WorkflowTaskOutcome;
};
import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
import type { ClaudeAgentPlugin } from "../claude/delivery-gate.js";
/**
 * FsPlugin — executes deterministic filesystem operations after H approval.
 *
 * Separate from CursorEditorPlugin because FS ops bypass the intake pipeline
 * and session state machine entirely. They are always-executable primitives.
 *
 * CursorInProcessAdapter implements this interface alongside CursorEditorPlugin.
 */
export type FsPlugin = {
    executeFsOp(op: FsChange): Promise<{
        readonly kind: "accepted" | "failed";
        readonly detail?: string;
        readonly stdout?: string;
        readonly stderr?: string;
        readonly exitCode?: number;
        /**
         * Optional machine-readable failure category surfaced verbatim to the
         * CLI's --output json layer. When set, takes precedence over the generic
         * "execution_error" fallback. Must be one of the adapter-layer codes
         * documented in src/shell/cli/use-steady.ts HELP_TEXT.
         *
         * Examples:
         *   "target_exists"   — refused write because destination already exists.
         *   "merge_conflict"  — refused unsafe edit (symlink target, etc).
         */
        readonly errorCode?: string;
    }>;
};
/**
 * WorkflowPlugins — the set of runtime plugins the coordinator may use.
 *
 * The coordinator picks the plugin based on the current task's runtime.
 * It never converts one runtime's plugin into another (proof W8 / Proof 3).
 */
export type WorkflowPlugins = {
    readonly cursor?: CursorEditorPlugin;
    readonly claude?: ClaudeAgentPlugin;
    readonly fs?: FsPlugin;
};
export type { FsChange };
//# sourceMappingURL=types.d.ts.map