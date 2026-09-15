/**
 * Phase 11A-Web: Browser-safe type mirror for the frozen core contracts.
 *
 * These are structural mirrors of the Node.js-side types.
 * They are NOT imports of the core; they are defined independently here so
 * the React bundle has zero dependency on Node.js modules (fs, path, etc.).
 *
 * Rule: if a core type changes structure, update this mirror in lockstep.
 * Authority: none. These are read-only DTOs received from the API server.
 */

// ─── Provider status (mirrors src/utils/credentials.ts) ──────────────────────
// #150 credential pre-flight. Browser mirror of ProviderStatusDto. Only
// presence flags are exposed — never the key value itself.

export type ProviderStatus = {
  readonly id:          string;
  readonly displayName: string;
  readonly envKey:      string;
  readonly setupUrl?:   string;
  readonly runtimes:    readonly string[];
  readonly configured:  boolean;
  readonly liveMode:    boolean;
};

export type ProviderStatusResponse = {
  readonly providers: readonly ProviderStatus[];
};

// ─── ShellFrame (mirrors src/shell/types.ts) ──────────────────────────────────

export type ShellPrompt =
  | { kind: "confirm"; question: string }
  | { kind: "choose";  question: string; choices: readonly string[] };

export type ShellFrame = {
  readonly lines:   readonly string[];
  readonly prompt?: ShellPrompt;
};

// ─── WorkflowRun phases ───────────────────────────────────────────────────────

export type WorkflowRunPhase =
  | "reviewing"
  | "running"
  | "task_ready"
  | "task_conflict"
  | "task_approved"
  | "task_failed"
  | "task_scope"
  | "completed"
  | "stopped";

// ─── WorkflowTask (simplified view model) ────────────────────────────────────

export type WorkflowTaskOutcome =
  | "accepted"
  | "rejected"
  | "skipped"
  | "skipped_by_intake"
  | "planning_reviewed"
  | "stopped"
  | "pending";

export type ConfirmedUnderstandingV1 = {
  readonly format: "usesteady.confirmed-understanding.v1";
  readonly bullets: readonly string[];
  readonly rawInput: string;
  readonly confirmedAt: string;
};

export type ApprovedEffectiveBind = {
  readonly abs: string;
  readonly rel: string;
};

export type FsChange =
  | { readonly operationType: "create_dir";  readonly dirPath: string; readonly approvedEffective?: ApprovedEffectiveBind }
  | { readonly operationType: "write_file";  readonly filePath: string; readonly content: string; readonly approvedEffective?: ApprovedEffectiveBind }
  | { readonly operationType: "rename";      readonly filePath: string; readonly newPath: string; readonly approvedEffectiveFrom?: ApprovedEffectiveBind; readonly approvedEffectiveTo?: ApprovedEffectiveBind }
  | { readonly operationType: "delete_file"; readonly filePath: string; readonly approvedEffective?: ApprovedEffectiveBind };

export type WorkPlanOperatorAction = "approve" | "provide_input" | "decide";
export type WorkPlanTaskStatus = "pending" | "active" | "done";
export type WorkPlanEvidenceLevel = "explicit" | "derived";

export type WorkPlanSourceRef = {
  readonly ref: "rawInput" | `bullet:${number}`;
  readonly start: number;
  readonly end: number;
};

export type WorkPlanTask = {
  readonly id: string;
  readonly action: string;
  readonly target: string;
  readonly outcome: string;
  readonly operatorAction: WorkPlanOperatorAction;
  readonly sourceSpan: WorkPlanSourceRef;
  readonly status: WorkPlanTaskStatus;
  readonly evidenceLevel: WorkPlanEvidenceLevel;
  readonly precondition?: string;
};

export type WorkPlan = {
  readonly goal: string;
  readonly sourceContractRef: "rawInput";
  readonly tasks: readonly WorkPlanTask[];
  readonly nextAction: string;
  readonly terminalOutcome: string;
  readonly trustClass: "pre_execution_review";
  readonly deliverableType: string;
  readonly planHash: string;
};

export type WorkflowTaskSpec = {
  readonly input:          string;
  readonly label?:         string;
  readonly runtime:        "cursor" | "claude";
  readonly targetFiles?:   readonly string[];
  readonly operationType?: "replace" | "create_dir" | "write_file" | "rename" | "delete_file";
  readonly content?:       string;
  readonly newPath?:       string;
  readonly planningReview?: true;
};

export type WorkflowTask = {
  readonly taskIndex:   number;
  readonly spec:        WorkflowTaskSpec;
  readonly outcome:     WorkflowTaskOutcome | null;
  readonly retryCount:  number;
};

// ─── WorkflowRun (subset the UI needs) ───────────────────────────────────────

export type WorkflowSpec = {
  readonly name:  string;
  readonly tasks: readonly WorkflowTaskSpec[];
  readonly planningReviewHeadline?: string;
  readonly workPlan?: WorkPlan;
};

/**
 * CREATE_DIR_EFFECT_CONTRACT_V1 — server-derived pre-approval effect
 * disclosure (mirrors src/workflow/effect-closure.ts FsOpEffectDisclosure).
 * The UI renders this verbatim and never re-derives it.
 * `ancestors: null` means the closure is underivable — render the generic
 * disclosure, never an empty list.
 */
export type FsOpEffectDisclosure = {
  readonly target:    string;
  readonly ancestors: readonly string[] | null;
};

export type WorkflowRun = {
  readonly workflowRunId:      string;
  readonly executionInstanceId?: string;
  readonly spec:               WorkflowSpec;
  readonly phase:              WorkflowRunPhase;
  readonly currentIndex:       number;
  readonly tasks:              readonly WorkflowTask[];
  readonly workspaceRoot:      string;
  /** Present only when mode is "break_glass". Absent = normal approval flow. */
  readonly mode?:              "normal" | "break_glass";
  readonly breakGlassReason?:  string;
  /** Set when the current task is a filesystem operation (no session needed). */
  readonly currentFsOp?:       FsChange;
  /** Server-derived permitted-effect disclosure for currentFsOp (create_dir only). */
  readonly currentFsOpEffects?: FsOpEffectDisclosure;
};

// ─── History types (mirrors src/history/types.ts) ────────────────────────────

export type HistoryTaskOutcome =
  | "accepted"
  | "skipped"
  | "skipped_by_intake"
  | "stopped"
  | "rejected"
  | "pending";

export type WorkflowTaskHistoryEntry = {
  readonly taskIndex:  number;
  readonly outcome:    HistoryTaskOutcome;
  readonly retryCount: number;
  readonly input:      string | null;
};

export type WorkflowHistorySummary = {
  readonly envelopeId:    string;
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly workflowName:  string;
  readonly ts:            number;
  readonly finalOutcome:  "completed" | "stopped";
  readonly taskCount:     number;
  readonly acceptedCount: number;
  readonly skippedCount:  number;
  readonly tasks:         readonly WorkflowTaskHistoryEntry[];
};

export type SessionChain = {
  readonly runtime:    "cursor" | "claude" | "unknown";
  readonly intentId:   string | null;
  readonly responseId: string | null;
};

export type WorkflowTaskAuditEntry = {
  readonly taskIndex:  number;
  readonly input:      string | null;
  readonly outcome:    HistoryTaskOutcome;
  readonly retryCount: number;
  readonly session:    SessionChain | null;
};

export type WorkflowAuditRecord = {
  readonly envelopeId:    string;
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly workflowName:  string;
  readonly ts:            number;
  readonly finalOutcome:  "completed" | "stopped";
  readonly taskCount:     number;
  readonly acceptedCount: number;
  readonly skippedCount:  number;
  readonly tasks:         readonly WorkflowTaskAuditEntry[];
};

// ─── Execution Control (Phase 1) ─────────────────────────────────────────────
//
// Mirror of src/types/execution.ts — same pattern as WorkflowRun mirrors.
// The UI never imports from the core src/ package.

export type ExecutionStep = {
  id: string;
  file_path: string;
  action_type: "create" | "update" | "delete" | "rename";
  system_will: {
    summary: string;
    changes: { file: string; details: string }[];
    impact: string[];
    risk_notes: string[];
  };
  risk_level: "low" | "medium" | "high";
  why_explanation: string;
  status: "pending" | "approved" | "rejected";
};

export type SessionStepsResponse = {
  steps: ExecutionStep[];
};

export type DecisionResponse = {
  success:         boolean;
  /** True when the step was already decided — no write was performed. */
  idempotent?:     boolean;
  previousStatus?: string;
};

export type SessionStats = {
  total:                  number;
  decided:                number;
  approved:               number;
  rejected:               number;
  timeToFirstDecisionSec: number | null;
  approvalRate:           number | null;
  highRiskApprovalRate:   number | null;
  /** Reject count per action_type (absolute counts; only present for types with ≥1 reject). */
  rejectRateByActionType: Record<string, number>;
  /**
   * Hesitation index: revertCount / approved.
   * High  → users unsure → clarity issue in SYSTEM WILL or risk labeling.
   * ~Zero → confidence high → model is working.
   * null  → no approvals yet.
   */
  hesitationIndex: number | null;
  revertCount:     number;
};

// ─── Timeline (Phase 3) ───────────────────────────────────────────────────────

export type TimelineEntry = {
  stepId:      string;
  stepIndex:   number;
  action_type: ExecutionStep["action_type"];
  file_path:   string;
  risk_level:  ExecutionStep["risk_level"];
  decision:    "approved" | "rejected";
  decided_at:  string;
  summary:     string;
};

export type SessionTimelineResponse = {
  entries: TimelineEntry[];
};

// ─── Undo (Phase 3) ───────────────────────────────────────────────────────────

export type UndoResponse =
  | {
      success:            true;
      stepId:             string;
      file_path:          string;
      action_type:        string;
      /**
       * Seconds between original approval and this revert.
       *   ≤ 5s         → misclick / UI issue
       *   > 5s, ≤ 20s  → uncertain (borderline clarity — check risk label or SYSTEM WILL)
       *   > 20s        → comprehension or trust breakdown
       * null for pre-migration rows.
       */
      approveToRevertSec: number | null;
    }
  | { success: false; reason: string };

// ─── Skill suggestions (PI-4 Iter 2) ─────────────────────────────────────────
//
// Populated by the server when a completed run has skipped_by_intake tasks
// and the recovery-basic skill produced at least one suggestion.
// Zero-authority: these are advisory only, never canonical execution state.

export type RecoverySuggestion = {
  readonly input:  string;
  readonly reason: string;
};

export type TaskSkillSuggestions = {
  /** Array index of the task in run.tasks (0-based). */
  readonly taskIndex:   number;
  readonly suggestions: readonly RecoverySuggestion[];
};

// ─── Consensus audit (multi-LLM policy layer) ────────────────────────────────
//
// Mirrors the server-side ConsensusAuditRecord, minus decision hashes.
// Hashes are an implementation detail — quorumState + roundCount are the
// operationally useful signals for the UI.
//
// Mirror rule: if ConsensusAuditRecord changes structure, update this in lockstep.

export type ConsensusQuorumState =
  | "unanimous"
  | "primary_only"
  | "scope_blocked"
  | "no_quorum"
  | "timeout";

export type ConsensusPolicyMode =
  | "claude"
  | "multi"
  | "multi-strict";

export type ConsensusAuditSummary = {
  readonly requestId:          string;
  readonly primaryPlugin:      string;
  readonly policyMode:         ConsensusPolicyMode;
  readonly quorumState:        ConsensusQuorumState;
  readonly roundCount:         number;
  readonly finalDisposition:   string;
  readonly failedClosedReason?: string;
};

// ─── API response shapes ──────────────────────────────────────────────────────

/** Deterministic understanding artifact from POST /api/workflow/start (S1–S6). */
export type IntentReflectionArtifact = {
  readonly classification:
    | "initiative"
    | "capability"
    | "program"
    | "refactor"
    | "structure"
    | "primitive"
    | "unknown";
  readonly summary:         string;
  readonly key_points:    readonly string[];
  readonly next_step:       string;
  readonly originalRequest: string;
};

/**
 * RoutingSurface DTO mirror — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 3A).
 *
 * Browser-safe mirror of the engine type in src/workflow/routing-surface.ts.
 * The engine cannot import UI types, so this is an explicit mirror (Q3); a
 * Phase 4 parity test locks the two in sync. Carried additively on responses;
 * web/CLI renderers migrate to consume it in 3B/3C. Zero authority — describes
 * the pre-execution routing outcome only.
 */
export type SurfaceType =
  | "system_will"
  | "system_suggests"
  | "reflection"
  | "clarify"
  | "work_plan"
  | "safety";

export type SurfaceDiffHunk = {
  readonly kind: "added" | "removed" | "context";
  readonly line: string;
};

export type SurfaceDiff = {
  readonly filePath: string;
  readonly hunks: readonly SurfaceDiffHunk[];
};

export type WillOperation =
  | { readonly operationType: "create_dir";  readonly dirPath: string }
  | { readonly operationType: "write_file";  readonly filePath: string; readonly content: string }
  | { readonly operationType: "append_file"; readonly filePath: string; readonly content: string }
  | { readonly operationType: "prepend_file"; readonly filePath: string; readonly content: string }
  | { readonly operationType: "rename";      readonly filePath: string; readonly newPath: string }
  | { readonly operationType: "delete_file"; readonly filePath: string }
  | { readonly operationType: "run_command"; readonly command: string }
  | { readonly operationType: "replace";     readonly filePath: string; readonly oldValue: string; readonly newValue: string };

export type RoutingSurface =
  | { readonly type: "system_will"; readonly operation: WillOperation; readonly headline: string; readonly preview?: SurfaceDiff }
  | { readonly type: "system_suggests"; readonly suggestions: readonly { readonly input: string; readonly reason: string }[] }
  | {
      readonly type: "reflection";
      readonly classification: IntentReflectionArtifact["classification"];
      readonly summary: string;
      readonly keyPoints: readonly string[];
      readonly nextStep: string;
      readonly originalRequest: string;
    }
  | {
      readonly type: "clarify";
      readonly clarify:
        | { readonly mode: "slot_fill"; readonly kind: "missing_destination" | "ambiguous_type"; readonly slot: "destination" | "file_or_folder"; readonly prompt: string; readonly originalInput: string }
        | { readonly mode: "commitment"; readonly commitment: { readonly understood: string; readonly missing: string; readonly ask: string; readonly reentry: { readonly hint: string } }; readonly originalInput: string };
    }
  | { readonly type: "work_plan"; readonly workPlan: unknown }
  | {
      readonly type: "safety";
      readonly reason: string;
      readonly note: string;
      readonly blockedInput: string;
      readonly matchedPattern?: string;
      readonly detectorId?: string;
    };

export type RunResponse = {
  readonly runId:             string;
  readonly run:               WorkflowRun;
  readonly frame:             ShellFrame;
  readonly isTerminal:        boolean;
  readonly phase:             WorkflowRunPhase;
  /** Set when the server created an execution session for this workflow run.
   *  Use to navigate to /execution/:executionSessionId for step-level review. */
  readonly executionSessionId?: string;
  /** Present only when the run completed with skipped_by_intake tasks
   *  and the recovery skill produced suggestions. Absent = no suggestions. */
  readonly skillSuggestions?: readonly TaskSkillSuggestions[];
  /** Present when Runtime intent reflection applies — UI must confirm before ReviewingFrame. */
  readonly intentReflection?: IntentReflectionArtifact;
  /** RoutingSurface (Phase 3A) — additive; renderers migrate to it in 3B/3C. */
  readonly routingSurface?: RoutingSurface;
};

/**
 * USESTEADY_CLARIFY_THEN_PROMOTE_V1 — Phase 3/web.
 *
 * Returned by POST /api/workflow/start INSTEAD of a RunResponse when a single
 * bare-NL task is recoverable with exactly one missing slot. The client asks
 * for that slot and re-submits start with `clarifyAnswer`; no run exists yet.
 */
export type ClarifyPrompt = {
  readonly kind:          "missing_destination" | "ambiguous_type";
  readonly slot:          "destination" | "file_or_folder";
  readonly prompt:        string;
  readonly originalInput: string;
};

/**
 * Returned by POST /api/workflow/start INSTEAD of a RunResponse when the
 * single-authority safety gate blocks the request (Trust Surface Model,
 * Phase 2). No run is created. This is the SAME gate the CLI applies, so the
 * approval boundary no longer depends on the entry path.
 */
export type SafetyBlock = {
  readonly reason:          string;
  readonly note:            string;
  readonly blockedInput:    string;
  readonly matchedPattern?: string;
  readonly detectorId?:     string;
};

export type StartResponse =
  | RunResponse
  | { readonly clarify: ClarifyPrompt; readonly routingSurface?: RoutingSurface }
  | { readonly safetyBlock: SafetyBlock; readonly routingSurface?: RoutingSurface };

export function isClarifyResponse(
  r: StartResponse,
): r is { readonly clarify: ClarifyPrompt } {
  return (r as { clarify?: ClarifyPrompt }).clarify !== undefined;
}

export function isSafetyBlockResponse(
  r: StartResponse,
): r is { readonly safetyBlock: SafetyBlock } {
  return (r as { safetyBlock?: SafetyBlock }).safetyBlock !== undefined;
}
