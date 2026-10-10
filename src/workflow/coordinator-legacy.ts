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
 *   answerWorkflowScope(run, idx, ...)    → "task_ready" (newly bound; fresh approval required)
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
 *                         // now task_ready — H must approve the bound receiver
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

import { createHash } from "node:crypto";

// ─── Product session imports ──────────────────────────────────────────────────

import {
  createSession,
  submit,
  approve,
  reject,
  acceptConflict,
  answerScope,
  deliver,
  isTerminal as isCursorTerminal,
} from "../product/cursor-product-session.js";

import {
  createClaudeSession,
  submitClaude,
  approveClaude,
  rejectClaude,
  acceptClaudeConflict,
  answerClaudeScope,
  deliverClaude,
  supersedeClaudeAdvisory,
  retireClaudeAdvisory,
  isClaudeTerminal,
} from "../product/claude-product-session.js";
import {
  groundsIdFromBasis,
  validateRetirementRequest,
} from "../claude/objection-retirement.js";
import type { ModelRetirementRecord } from "../claude/types.js";

// ─── Type imports ─────────────────────────────────────────────────────────────

import type { CursorOCDPolicy }  from "../cursor/types.js";
import type { ClaudeOCDPolicy }  from "../claude/artifact-mapper.js";
import type { ClaudeToolPolicy } from "../claude/types.js";
import type { ClaudeGateDeps }   from "../claude/delivery-gate.js";

import type {
  WorkflowSpec,
  WorkflowRun,
  WorkflowRunPhase,
  WorkflowTask,
  WorkflowTaskOutcome,
  WorkflowDisplay,
  WorkflowDisplayErrorCode,
  WorkflowCurrentSession,
  WorkflowOCDOverride,
  WorkflowPlugins,
  WorkflowTaskSummaryLine,
  FsChange,
} from "./types.js";

// S4 / friction #44 — `parseChange` is no longer reachable from the
// workflow coordinator. WorkflowSpec NL is normalized at spec-load time
// via `synthesizeStructuredFieldsFromNL` (src/shell/cli/spec-nl-synth.ts)
// so every task arriving here carries structured fields. The legacy
// `parseChange` import remains used by `src/shell/cli/draft/intent-to-tasks.ts`
// for the entry-layer draft path; only this coordinator's NL fallback is
// removed. `isFsChange` (a `parseChange` companion type guard) is also no
// longer needed here. Governance test
// `tests/governance/input-surface-integrity.test.ts` enforces that
// `parseChange` is no longer reachable from any workflow surface.
import {
  bindEffectiveFsChange,
  bindOnePath,
  displayBoundPath,
  fsChangeMissingRequiredReceiver,
  EFFECTIVE_RESOURCE_RECEIVER_REQUIRED_MSG,
} from "../input/effective-resource.js";
import { bindArtifactEffectiveReceiver } from "../cursor/artifact-mapper.js";
import { bindClaudeArtifactEffectiveReceiver } from "../claude/artifact-mapper.js";
import { recordRuntimeLedgerEvent } from "../observe/drl-ledger-writer.js";
import {
  classifyUnresolvedIntent,
  unresolvedReasonMessage,
} from "../execution/unresolved-classification.js";

import type { WorkflowRunPayload } from "../ucp/types.js";
import { createWorkflowRunEnvelope, createModelPositionRetirementEnvelope } from "../ucp/envelope.js";
import { persistEnvelope } from "../ucp/persistence/index.js";
import { createExecutionInstanceId } from "./execution-instance.js";
import { nextExecutionOrdinal, listWorkflowRunEnvelopes } from "../history/execution-instance-resolve.js";
import { stableStringify } from "../ucp/hashes.js";
import {
  observeAndPersistFsOutcome,
  unverifiedFromAccepted,
} from "./persist-outcome-verification.js";
import type { RealityProbe } from "../governed-decision/stages/observation.js";
import {
  computeWorkflowSpecHash,
  verifyWorkflowSpecHash,
} from "./spec-hash.js";
import {
  assembleDecisionBasis,
  computeDecisionBasisFingerprint,
  verifyDecisionBasisFingerprint,
} from "../constitution/index.js";
import type { RepositoryProvenanceFact } from "../constitution/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 2;

function taskLabel(t: WorkflowTask): string {
  return t.spec.label ?? t.spec.input.slice(0, 60);
}

function runtimeFor(run: WorkflowRun, index: number): "cursor" | "claude" {
  // W8: runtime comes from spec only. Never derived from content.
  return run.spec.tasks[index]?.runtime ?? run.spec.defaultRuntime ?? "cursor";
}

function maxRetries(run: WorkflowRun): number {
  return run.spec.maxRetries ?? DEFAULT_MAX_RETRIES;
}

function applyOCDOverride(
  base:     CursorOCDPolicy,
  override: WorkflowOCDOverride | undefined,
): CursorOCDPolicy {
  // W6: can only add prohibited globs, never remove.
  if (!override || override.additionalProhibitedGlobs.length === 0) return base;
  return {
    ...base,
    alwaysProhibitedGlobs: [
      ...base.alwaysProhibitedGlobs,
      ...override.additionalProhibitedGlobs,
    ],
  };
}

// ─── FS operation helpers ──────────────────────────────────────────────────────

/**
 * Build an FsChange from a structured WorkflowTaskSpec (when operationType is set).
 * Returns undefined if the spec fields are incomplete for the given operation.
 */
export function buildFsChangeFromSpec(
  spec: import("./types.js").WorkflowTaskSpec,
): FsChange | undefined {
  switch (spec.operationType) {
    case "create_dir": {
      const p = spec.targetFiles?.[0];
      return p ? { operationType: "create_dir", dirPath: p } : undefined;
    }
    case "write_file": {
      const p = spec.targetFiles?.[0];
      return p !== undefined && spec.content !== undefined
        ? { operationType: "write_file", filePath: p, content: spec.content }
        : undefined;
    }
    case "rename": {
      const p = spec.targetFiles?.[0];
      return p !== undefined && spec.newPath !== undefined
        ? { operationType: "rename", filePath: p, newPath: spec.newPath }
        : undefined;
    }
    case "delete_file": {
      const p = spec.targetFiles?.[0];
      return p ? { operationType: "delete_file", filePath: p } : undefined;
    }
    case "append_file": {
      const p = spec.targetFiles?.[0];
      return p !== undefined && spec.content !== undefined
        ? { operationType: "append_file", filePath: p, content: spec.content }
        : undefined;
    }
    case "prepend_file": {
      const p = spec.targetFiles?.[0];
      return p !== undefined && spec.content !== undefined
        ? { operationType: "prepend_file", filePath: p, content: spec.content }
        : undefined;
    }
    case "run_command": {
      return spec.command
        ? { operationType: "run_command", command: spec.command }
        : undefined;
    }
    default:
      return undefined;
  }
}

// S4 / friction #44 — `isDeliverableTaskSpec` only inspects structured
// fields. NL parsing happens at the input boundary (spec-load via
// `synthesizeStructuredFieldsFromNL`, or `processNLInput` for the
// entry-layer surfaces). A WorkflowTaskSpec arriving here without
// structured fields is by definition unresolved — it means the input
// boundary failed to synthesize and the spec should never have reached
// the coordinator. Pre-S4 this function used `parseChange` and
// `hasDeterministicReplaceInput` as a runtime NL fallback, which made
// `WorkflowSpec.tasks[].input` an ungoverned NL surface (#44). Removing
// the fallback here is the load-bearing change of S4.
//
// Naming (Stuart Finding 9 / W1 closure): this is a structural
// deliverability check — does the spec carry every structured field its
// operation kind requires for direct delivery (run_command: a non-empty
// command; write_file: path + content; etc.)? It is NOT the kernel replay
// determinism classifier (`src/kernel/command-classifier.ts`), which
// scopes `replay --execute` only. Renamed from `isDeterministicTaskSpec`
// because the old name collided with that kernel vocabulary.
export function isDeliverableTaskSpec(spec: import("./types.js").WorkflowTaskSpec): boolean {
  if (spec.operationType === "create_dir") return Boolean(spec.targetFiles?.[0]);
  if (spec.operationType === "write_file") return spec.targetFiles?.[0] !== undefined && spec.content !== undefined;
  if (spec.operationType === "rename") return spec.targetFiles?.[0] !== undefined && spec.newPath !== undefined;
  if (spec.operationType === "delete_file") return Boolean(spec.targetFiles?.[0]);
  if (spec.operationType === "append_file" || spec.operationType === "prepend_file") {
    return spec.targetFiles?.[0] !== undefined && spec.content !== undefined;
  }
  if (spec.operationType === "run_command") return Boolean(spec.command?.trim());
  if (spec.structuredReplace) return true;
  return false;
}

function unresolvedCompileReason(spec: import("./types.js").WorkflowTaskSpec): string {
  if (spec.operationType === "create_dir" && !spec.targetFiles?.[0]) {
    return "create_dir requires an explicit target path.";
  }
  if (
    spec.operationType === "write_file" &&
    (spec.targetFiles?.[0] === undefined || spec.content === undefined)
  ) {
    return "write_file requires target path and concrete content.";
  }
  if (
    spec.operationType === "rename" &&
    (spec.targetFiles?.[0] === undefined || spec.newPath === undefined)
  ) {
    return "rename requires source path and destination path.";
  }
  if (spec.operationType === "delete_file" && !spec.targetFiles?.[0]) {
    return "delete_file requires an explicit target path.";
  }
  if (
    (spec.operationType === "append_file" || spec.operationType === "prepend_file") &&
    (spec.targetFiles?.[0] === undefined || spec.content === undefined)
  ) {
    return `${spec.operationType} requires target path and concrete content.`;
  }
  if (spec.operationType === "run_command" && !spec.command?.trim()) {
    return "run_command requires a concrete command.";
  }
  return "Could not resolve into supported primitive";
}

function unresolvedCompileFailureNote(spec: import("./types.js").WorkflowTaskSpec): string {
  const reason = unresolvedCompileReason(spec);
  const category = classifyUnresolvedIntent(spec, reason);
  const blockedReason = unresolvedReasonMessage(category);
  return `This step could not be resolved into a supported operation. ${blockedReason} Try specifying one action, one target, and explicit content or path.`;
}

function fsOpHeadline(op: FsChange, taskNum: number): string {
  switch (op.operationType) {
    case "create_dir":  return `Task ${taskNum}: Create directory ${displayBoundPath(op.dirPath, op.approvedEffective)}`;
    case "write_file":  return `Task ${taskNum}: Create file ${displayBoundPath(op.filePath, op.approvedEffective)}`;
    case "append_file": return `Task ${taskNum}: Append to ${displayBoundPath(op.filePath, op.approvedEffective)}`;
    case "prepend_file": return `Task ${taskNum}: Prepend to ${displayBoundPath(op.filePath, op.approvedEffective)}`;
    case "rename":      return `Task ${taskNum}: Rename ${displayBoundPath(op.filePath, op.approvedEffectiveFrom)} → ${displayBoundPath(op.newPath, op.approvedEffectiveTo)}`;
    case "delete_file": return `Task ${taskNum}: Delete ${displayBoundPath(op.filePath, op.approvedEffective)}`;
    case "run_command": return `Task ${taskNum}: Run command "${op.command}"`;
  }
}

/**
 * P-F01 — bind currentFsOp to the effective receiver before SYSTEM WILL
 * is shown. Spec inputs are not rewritten (W7). Missing workspaceRoot
 * leaves the run unchanged so existing coordinator tests stay intact;
 * production callers (CLI shell, server) always supply the root.
 *
 * Fail-closed: alias escape or unresolved hop → task_failed with no
 * approval granted and no effect.
 */
export function bindEffectiveResourceOnReady(
  run: WorkflowRun,
  workspaceRoot: string | undefined,
): WorkflowRun {
  if (workspaceRoot === undefined || workspaceRoot.length === 0) return run;
  if (run.phase !== "task_ready" && run.phase !== "task_conflict") return run;
  if (run.currentFsOp === undefined) {
    const session = run.currentSession;
    if (session === undefined) return run;
    if (session.runtime === "cursor") {
      const artifact = session.state.artifact;
      const parsed = artifact?.changeSpec.parsedChange;
      if (artifact === undefined || parsed?.filePath === undefined || parsed.approvedEffective !== undefined) return run;
      const bound = bindOnePath(workspaceRoot, parsed.filePath);
      if (!bound.ok) {
        return transitionToFailed(run, run.currentIndex, `${bound.message} Refused before approval.`, undefined, undefined, bound.code);
      }
      const nextArtifact = bindArtifactEffectiveReceiver(artifact, bound.bind);
      if (nextArtifact === artifact) return run;
      const nextParsed = session.state.parsedChange !== undefined
        && session.state.parsedChange.approvedEffective === undefined
        ? { ...session.state.parsedChange, approvedEffective: bound.bind }
        : session.state.parsedChange;
      return mk(run.phase, run, {
        currentSession: {
          runtime: "cursor",
          state: {
            ...session.state,
            artifact: nextArtifact,
            ...(nextParsed !== undefined ? { parsedChange: nextParsed } : {}),
            ...(session.state.prepResult !== undefined && session.state.prepResult.kind !== "not_execute"
              ? { prepResult: { ...session.state.prepResult, artifact: nextArtifact } }
              : {}),
          },
        },
      });
    }
    const artifact = session.state.artifact;
    const parsed = artifact?.taskSpec.parsedChange;
    if (artifact === undefined || parsed?.filePath === undefined || parsed.approvedEffective !== undefined) return run;
    const bound = bindOnePath(workspaceRoot, parsed.filePath);
    if (!bound.ok) {
      return transitionToFailed(run, run.currentIndex, `${bound.message} Refused before approval.`, undefined, undefined, bound.code);
    }
    const nextArtifact = bindClaudeArtifactEffectiveReceiver(artifact, bound.bind);
    if (nextArtifact === artifact) return run;
    const sessionParsed = session.state.parsedChange;
    const nextParsed = sessionParsed !== undefined
      && !("operationType" in sessionParsed)
      && sessionParsed.approvedEffective === undefined
      ? { ...sessionParsed, filePath: parsed.filePath, approvedEffective: bound.bind }
      : sessionParsed;
    return mk(run.phase, run, {
      currentSession: {
        runtime: "claude",
        state: {
          ...session.state,
          artifact: nextArtifact,
          ...(nextParsed !== undefined ? { parsedChange: nextParsed } : {}),
          ...(session.state.prepResult !== undefined && session.state.prepResult.kind !== "not_execute"
            ? { prepResult: { ...session.state.prepResult, artifact: nextArtifact } }
            : {}),
        },
      },
    });
  }

  // Re-rendering the same pending decision must not refresh what was approved.
  const op = run.currentFsOp;
  if (op.operationType === "rename") {
    if (op.approvedEffectiveFrom !== undefined && op.approvedEffectiveTo !== undefined) return run;
  } else if (op.operationType !== "run_command" && op.approvedEffective !== undefined) {
    return run;
  }

  const bound = bindEffectiveFsChange(run.currentFsOp, workspaceRoot);
  if (!bound.ok) {
    return transitionToFailed(
      run,
      run.currentIndex,
      `${bound.message} Refused before approval.`,
      undefined,
      undefined,
      bound.code,
    );
  }
  if (bound.op === run.currentFsOp) return run;
  const display = buildDisplay(
    run,
    fsOpHeadline(bound.op, run.currentIndex + 1),
  );
  return mk(
    run.phase,
    run,
    run.phase === "task_conflict"
      ? { currentFsOp: bound.op }
      : { currentFsOp: bound.op, display },
  );
}

function applyClaudeOCDOverride(
  base:     ClaudeOCDPolicy,
  override: WorkflowOCDOverride | undefined,
): ClaudeOCDPolicy {
  // W6: can only add prohibited globs, never remove.
  if (!override || override.additionalProhibitedGlobs.length === 0) return base;
  return {
    ...base,
    alwaysProhibitedGlobs: [
      ...base.alwaysProhibitedGlobs,
      ...override.additionalProhibitedGlobs,
    ],
  };
}

/**
 * Spec / workflow identity from `name` + `tasks`. Same specification ⇒
 * same id. This is NOT an execution-instance identity (P-MED / F-02).
 * Exported so the SDK can bind ApprovalRecord to the spec identity
 * `createWorkflowRun` will assign as `workflowRunId`.
 */
export function deriveWorkflowRunId(spec: WorkflowSpec): string {
  const content = JSON.stringify({ name: spec.name, tasks: spec.tasks });
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Abort the workflow to "stopped" because the live spec hash no longer
 * matches the hash recorded at createWorkflowRun time.
 *
 * Row 2 of the SafeHarness Hardening Map: indicates the spec object was
 * mutated after operator approval. Treated as fail-closed — the workflow
 * never executes against an unapproved definition.
 *
 * Failure note records both digests (truncated to 16 hex chars for
 * readability) so the operator can confirm the divergence.
 */
function abortOnSpecHashMismatch(
  run:      WorkflowRun,
  expected: string,
  actual:   string,
): WorkflowRun {
  const expectedShort = expected.slice(0, 16);
  const actualShort   = actual.slice(0, 16);
  const failureNote =
    `Workflow spec hash mismatch — execution aborted. ` +
    `Expected ${expectedShort}…; got ${actualShort}…. ` +
    `The spec object was modified after the operator approved this workflow.`;
  const display = buildDisplay(
    run,
    `Workflow "${run.spec.name}" stopped: spec hash mismatch.`,
    { failureNote, errorCode: "spec_hash_mismatch" },
  );
  return mk("stopped", run, { currentSession: undefined, display } as unknown as MkOverrides);
}

/**
 * Constitution Materialization V1 — fail-closed abort on Decision Basis
 * fingerprint mismatch (USESTEADY_CONSTITUTION_V1 Article V, INV-COMP-2).
 *
 * The basis recomputed at the execution side-effect surface no longer matches
 * the fingerprint recorded with the approval. Reality moved between approval and
 * execution: the decision is no longer certified. Abort to "stopped".
 */
function abortOnDecisionBasisMismatch(
  run:      WorkflowRun,
  expected: string,
  actual:   string,
): WorkflowRun {
  const expectedShort = expected.slice(0, 16);
  const actualShort   = actual.slice(0, 16);
  const failureNote =
    `Decision Basis fingerprint mismatch — execution aborted. ` +
    `Expected ${expectedShort}…; got ${actualShort}…. ` +
    `The decision basis changed after the operator approved this workflow.`;
  const display = buildDisplay(
    run,
    `Workflow "${run.spec.name}" stopped: decision basis mismatch.`,
    { failureNote, errorCode: "decision_basis_mismatch" },
  );
  return mk("stopped", run, { currentSession: undefined, display } as unknown as MkOverrides);
}

// ─── Display builders ─────────────────────────────────────────────────────────

function buildDisplay(
  run:          { spec: WorkflowSpec; tasks: readonly WorkflowTask[]; currentIndex: number },
  headline:     string,
  extras:       { failureNote?: string; errorCode?: WorkflowDisplayErrorCode } = {},
): WorkflowDisplay {
  const total   = run.spec.tasks.length;
  const current = run.currentIndex + 1;
  const progress = `Task ${Math.min(current, total)} of ${total}`;

  const currentTask = run.spec.tasks[run.currentIndex];
  const currentLabel = currentTask
    ? (currentTask.label ?? currentTask.input.slice(0, 60))
    : undefined;

  const taskSummary: WorkflowTaskSummaryLine[] = run.tasks
    .filter(t => t.outcome !== "pending")
    .map(t => ({ index: t.index, label: taskLabel(t), outcome: t.outcome }));

  return {
    headline,
    progress,
    ...(currentLabel !== undefined ? { currentLabel } : {}),
    ...(taskSummary.length > 0 ? { taskSummary } : {}),
    ...(extras.failureNote ? { failureNote: extras.failureNote } : {}),
    ...(extras.errorCode   ? { errorCode:   extras.errorCode   } : {}),
  };
}

// ─── Task array helpers ───────────────────────────────────────────────────────

function updateTask(
  tasks:   readonly WorkflowTask[],
  index:   number,
  updater: (t: WorkflowTask) => WorkflowTask,
): readonly WorkflowTask[] {
  return tasks.map((t, i) => (i === index ? updater(t) : t));
}

// ─── Run builder ──────────────────────────────────────────────────────────────

// Allow explicitly-undefined values for currentSession / currentFsOp to signal "clear this field".
type MkOverrides = Partial<Omit<WorkflowRun, "phase" | "workflowRunId" | "executionInstanceId" | "workflowSpecHash" | "decisionBasisFingerprint" | "spec">> & {
  currentSession?: WorkflowCurrentSession | undefined;
  currentFsOp?:    FsChange | undefined;
};

function mk(
  phase:     WorkflowRunPhase,
  base:      WorkflowRun,
  overrides: MkOverrides,
): WorkflowRun {
  const merged = { ...base, phase, ...overrides };
  // Filter undefined values when explicitly clearing currentSession or currentFsOp.
  if ("currentSession" in overrides || "currentFsOp" in overrides) {
    return Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined),
    ) as WorkflowRun;
  }
  return merged;
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
export function createWorkflowRun(
  spec: WorkflowSpec,
  opts?: {
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
    /**
     * P-MED / F-02 — continue an existing execution instance (resume of A).
     * Omitted: mint a new instance id. Must not be derived from the spec.
     */
    executionInstanceId?: string;
  },
): WorkflowRun {
  const tasks: WorkflowTask[] = spec.tasks.map((s, i) => ({
    index:      i,
    spec:       s,
    outcome:    "pending" as WorkflowTaskOutcome,
    retryCount: 0,
  }));

  const display = buildDisplay(
    { spec, tasks, currentIndex: 0 },
    `Workflow "${spec.name}" ready. ${spec.tasks.length} task(s).`,
  );

  const mode = opts?.mode ?? "normal";
  const breakGlassReason = opts?.breakGlassReason;

  return {
    phase:            "reviewing",
    workflowRunId:    deriveWorkflowRunId(spec),
    executionInstanceId: opts?.executionInstanceId ?? createExecutionInstanceId(),
    workflowSpecHash: computeWorkflowSpecHash(spec),
    // Constitution Materialization V1 (Article VI): record the Decision Basis
    // fingerprint with the approval at reviewing time. Re-checked at the
    // deliverWorkflowTask side-effect surface (Article V, INV-COMP-2).
    // Increment 1: any injected Repository provenance is folded in here, so the
    // fingerprint covers repository state the spec hash cannot (F-C2). With no
    // provenance the basis is spec-only — identical to prior behavior.
    decisionBasisFingerprint: computeDecisionBasisFingerprint(
      assembleDecisionBasis(spec, { repository: opts?.repositoryProvenance ?? null }),
    ),
    spec,
    tasks,
    currentIndex:     0,
    display,
    ...(mode !== "normal" ? { mode } : {}),
    ...(breakGlassReason  ? { breakGlassReason } : {}),
  };
}

// ─── startWorkflow ────────────────────────────────────────────────────────────

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
export function startWorkflow(
  run:              WorkflowRun,
  cursorPolicy:     CursorOCDPolicy,
  claudeOCDPolicy:  ClaudeOCDPolicy,
  claudeToolPolicy: ClaudeToolPolicy,
): WorkflowRun {
  if (run.phase !== "reviewing") return run;

  // Transition to "idle" (internal phase) without touching tasks or sessions.
  const idleRun: WorkflowRun = { ...run, phase: "idle" as WorkflowRunPhase };
  return advanceWorkflow(idleRun, cursorPolicy, claudeOCDPolicy, claudeToolPolicy);
}

// ─── cancelWorkflow ───────────────────────────────────────────────────────────

/**
 * Cancel the workflow at the pre-flight stage.
 *
 * H declined to start. No session was ever created (WF-R1).
 * Transitions "reviewing" → "stopped" cleanly.
 *
 * Valid from "reviewing" only; no-op from any other phase.
 */
export function cancelWorkflow(run: WorkflowRun): WorkflowRun {
  if (run.phase !== "reviewing") return run;
  const display = buildDisplay(run, `Workflow "${run.spec.name}" cancelled before start.`);
  return mk("stopped", run, { currentSession: undefined, display } as unknown as MkOverrides);
}

// ─── Terminal guard ───────────────────────────────────────────────────────────

export function isWorkflowTerminal(run: WorkflowRun): boolean {
  return run.phase === "completed" || run.phase === "stopped";
}

// ─── advanceWorkflow ──────────────────────────────────────────────────────────

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
export function advanceWorkflow(
  run:              WorkflowRun,
  cursorPolicy:     CursorOCDPolicy,
  claudeOCDPolicy:  ClaudeOCDPolicy,
  claudeToolPolicy: ClaudeToolPolicy,
): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  // "reviewing" is guarded here (WF-R3): only startWorkflow() may exit reviewing.
  if (run.phase !== "idle" && run.phase !== "running") return run;

  // Spec-hash invariant: the live spec must still match the hash recorded
  // at createWorkflowRun time. A mismatch means the spec object was mutated
  // after operator approval; abort the workflow to "stopped" fail-closed.
  // (Row 2 of the SafeHarness Hardening Map.)
  const hashCheck = verifyWorkflowSpecHash(run.spec, run.workflowSpecHash);
  if (!hashCheck.ok) {
    return abortOnSpecHashMismatch(run, hashCheck.expected, hashCheck.actual);
  }

  // All tasks exhausted.
  if (run.currentIndex >= run.spec.tasks.length) {
    const display = buildDisplay(run, `Workflow "${run.spec.name}" completed.`);
    return mk("completed", run, { display });
  }

  const idx      = run.currentIndex;
  const runtime  = runtimeFor(run, idx);
  const taskSpec = run.spec.tasks[idx]!;

  // Planning-review route: non-execution; no intake, no session, no skipped_by_intake.
  if (taskSpec.planningReview) {
    const updatedTasks = updateTask(run.tasks, idx, t => ({
      ...t,
      outcome: "planning_reviewed" as WorkflowTaskOutcome,
    }));
    const nextIndex = idx + 1;
    const progressed: WorkflowRun = {
      ...run,
      tasks:        updatedTasks,
      currentIndex: nextIndex,
      phase:        "running" as WorkflowRunPhase,
      display:      buildDisplay(
        { spec: run.spec, tasks: updatedTasks, currentIndex: nextIndex },
        `Task ${idx + 1}: planning review recorded.`,
      ),
    };
    return advanceWorkflow(progressed, cursorPolicy, claudeOCDPolicy, claudeToolPolicy);
  }

  if (!isDeliverableTaskSpec(taskSpec)) {
    recordRuntimeLedgerEvent({
      prompt: taskSpec.input,
      outcome: "BLOCK",
      reason: "Task spec lacks the structured fields required for delivery.",
      notes: ["coordinator.advanceWorkflow.not_deliverable"],
    });
    // AGENTS.md UI-W1 / locked invariant: unsupported inputs do NOT go to
    // FailureFrame. They auto-skip to `skipped_by_intake` so the
    // CompletedFrame OutcomeRow can render the COULD NOT UNDERSTAND trust
    // treatment (and Skills v1 SYSTEM SUGGESTS, when available).
    //
    // Pre-restoration this routed to `transitionToFailed`, which surfaced
    // unsupported NL as a generic failure with stop/skip/retry — breaking
    // Skills v1 wiring (the suggestion adapter only fires on
    // `skipped_by_intake`) and the safety-guard UX for ambiguous inputs.
    // The synthesized failure note is preserved on the display so the CLI
    // surface (and any debug-mode UI) can still inspect the reason.
    const noteMessage = unresolvedCompileFailureNote(taskSpec);
    const updatedTasks = updateTask(run.tasks, idx, t => ({
      ...t,
      outcome: "skipped_by_intake" as WorkflowTaskOutcome,
    }));
    const nextIndex = idx + 1;
    const next: WorkflowRun = {
      ...run,
      tasks:        updatedTasks,
      currentIndex: nextIndex,
      phase:        "running" as WorkflowRunPhase,
      display:      buildDisplay(
        { spec: run.spec, tasks: updatedTasks, currentIndex: nextIndex },
        `Task ${idx + 1}: ${noteMessage}`,
      ),
    };
    return advanceWorkflow(next, cursorPolicy, claudeOCDPolicy, claudeToolPolicy);
  }

  // ── FS operation fast path (bypasses intake entirely) ────────────────────
  //
  // S4 / friction #44: NL parsing happens at the input boundary, never
  // here. If an FS-shaped task arrives without a structured operationType,
  // it means spec-load synthesis failed to populate one — `isDeliverableTaskSpec`
  // already routed those to `transitionToFailed` above, so we will never
  // reach this block with an unstructured FS task. The pre-S4
  // `parseChange(taskSpec.input)` fallback was the source of #44 and is
  // intentionally gone.

  let detectedFsOp: FsChange | undefined;

  if (taskSpec.operationType && taskSpec.operationType !== "replace") {
    detectedFsOp = buildFsChangeFromSpec(taskSpec);
  }

  if (detectedFsOp !== undefined) {
    const updatedTasks = updateTask(run.tasks, idx, t => ({ ...t }));
    const display = buildDisplay(
      { spec: run.spec, tasks: updatedTasks, currentIndex: idx },
      fsOpHeadline(detectedFsOp, idx + 1),
    );
    return bindEffectiveResourceOnReady(
      mk("task_ready", run, { currentFsOp: detectedFsOp, tasks: updatedTasks, display }),
      cursorPolicy.workspaceRoot,
    );
  }

  // ── Submit the task to its session ───────────────────────────────────────

  let currentSession: WorkflowCurrentSession;

  if (runtime === "cursor") {
    // W8: runtime comes from spec. W6: override can only tighten.
    const policy  = applyOCDOverride(cursorPolicy, run.spec.ocdOverride);
    // structuredReplace bypasses parseChange for programmatic callers — safe for
    // from/to values containing double quotes, newlines, or other chars that
    // break the text-parsing regex pipeline (see WorkflowTaskSpec.structuredReplace).
    const session = submit(createSession(), taskSpec.input, policy, taskSpec.structuredReplace);
    currentSession = { runtime: "cursor", state: session };
  } else {
    const ocdPolicy = applyClaudeOCDOverride(claudeOCDPolicy, run.spec.ocdOverride);
    const session   = submitClaude(
      createClaudeSession(),
      taskSpec.input,
      ocdPolicy,
      claudeToolPolicy,
      taskSpec.structuredReplace,
      cursorPolicy.workspaceRoot,
    );
    currentSession  = { runtime: "claude", state: session };
  }

  const sessionPhase = currentSession.state.phase;

  // ── Surface non-execute modes explicitly (no silent skips) ───────────────
  // V1 default: intake_failed and not_execute are auto-skipped.
  // The display message and task record preserve the reason for the UI.

  if (sessionPhase === "not_execute" || sessionPhase === "intake_failed") {
    const display_msg = sessionPhase === "intake_failed"
      ? `Task ${idx + 1}: Input could not be processed.`
      : `Task ${idx + 1}: Input is not a supported operation.`;
    const updatedTasks = updateTask(run.tasks, idx, t => ({
      ...t,
      outcome:    "skipped_by_intake" as WorkflowTaskOutcome,
      ...(currentSession.state.intentId  !== undefined ? { intentId:  currentSession.state.intentId  } : {}),
      ...(currentSession.state.responseId !== undefined ? { responseId: currentSession.state.responseId } : {}),
    }));
    const nextIndex = idx + 1;
    const next: WorkflowRun = {
      ...run,
      tasks:        updatedTasks,
      currentIndex: nextIndex,
      phase:        "running" as WorkflowRunPhase,
      display:      buildDisplay(
        { spec: run.spec, tasks: updatedTasks, currentIndex: nextIndex },
        display_msg,
      ),
    };
    // Recurse to advance to the next task.
    return advanceWorkflow(next, cursorPolicy, claudeOCDPolicy, claudeToolPolicy);
  }

  if (sessionPhase === "exec_error") {
    const note = currentSession.state.display.headline || "Receiver identity could not be bound.";
    return transitionToFailed(
      run,
      idx,
      note,
      currentSession,
      undefined,
      "effective_resource_unresolved",
    );
  }

  // ── Surface prepared / conflict ───────────────────────────────────────────

  const nextPhase: WorkflowRunPhase =
    sessionPhase === "conflict" ? "task_conflict" : "task_ready";

  const updatedTasks = updateTask(run.tasks, idx, t => ({
    ...t,
    ...(currentSession.state.intentId  !== undefined ? { intentId:  currentSession.state.intentId  } : {}),
    ...(currentSession.state.responseId !== undefined ? { responseId: currentSession.state.responseId } : {}),
  }));

  const display = buildDisplay(
    { spec: run.spec, tasks: updatedTasks, currentIndex: idx },
    sessionPhase === "conflict"
      ? `Task ${idx + 1}: OCD conflict detected.`
      : (taskSpec.label ?? taskSpec.input.slice(0, 60)),
  );

  recordRuntimeLedgerEvent({
    prompt: taskSpec.input,
    outcome: "REVIEW_REQUIRED",
    reason: "Task reached operator review gate.",
    notes: [`coordinator.advanceWorkflow.${nextPhase}`],
  });

  return bindEffectiveResourceOnReady(
    mk(nextPhase, run, { tasks: updatedTasks, currentSession, display }),
    cursorPolicy.workspaceRoot,
  );
}

// ─── acceptWorkflowConflict ───────────────────────────────────────────────────

/**
 * Accept the OCD conflict on the current task.
 *
 * Valid from "task_conflict" only.
 * Transitions to "task_ready".
 */
export function acceptWorkflowConflict(run: WorkflowRun): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_conflict" || !run.currentSession) return run;

  let nextSession: WorkflowCurrentSession;
  if (run.currentSession.runtime === "cursor") {
    nextSession = { runtime: "cursor", state: acceptConflict(run.currentSession.state) };
  } else {
    nextSession = { runtime: "claude", state: acceptClaudeConflict(run.currentSession.state) };
  }

  const idx     = run.currentIndex;
  // Issue #42 -- track the accepted warning so the end-of-run summary
  // can acknowledge it instead of reporting "Completed successfully"
  // without mention. The OCD evaluator stays non-blocking by design;
  // this is purely an observability bump, no policy change.
  const updatedTasks = updateTask(run.tasks, idx, t => ({
    ...t,
    conflictsAccepted: (t.conflictsAccepted ?? 0) + 1,
  }));
  const display = buildDisplay(
    { ...run, tasks: updatedTasks },
    `Task ${idx + 1}: Conflict accepted. Ready for approval.`,
  );

  return mk("task_ready", run, {
    currentSession: nextSession,
    tasks:          updatedTasks,
    display,
  });
}

function workflowApprovalMissingReceiver(run: WorkflowRun): boolean {
  if (run.currentFsOp !== undefined) {
    return fsChangeMissingRequiredReceiver(run.currentFsOp);
  }
  const session = run.currentSession;
  if (session === undefined) return false;
  if (session.state.parsedChange !== undefined) {
    const parsed = session.state.parsedChange;
    if ("operationType" in parsed) {
      return fsChangeMissingRequiredReceiver(parsed);
    }
    if (parsed.filePath === undefined) return false;
    return parsed.approvedEffective === undefined;
  }
  if (session.runtime === "cursor") {
    const parsed = session.state.artifact?.changeSpec.parsedChange;
    if (parsed === undefined || parsed.filePath === undefined) return false;
    return parsed.approvedEffective === undefined;
  }
  const parsed = session.state.artifact?.taskSpec.parsedChange;
  if (parsed === undefined || parsed.filePath === undefined) return false;
  return parsed.approvedEffective === undefined;
}

// ─── confirmWorkflowTask ──────────────────────────────────────────────────────

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
export function confirmWorkflowTask(run: WorkflowRun, yes: boolean): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_ready" && run.phase !== "task_conflict") return run;

  const idx = run.currentIndex;

  if (yes && workflowApprovalMissingReceiver(run)) {
    return transitionToFailed(
      run,
      idx,
      `${EFFECTIVE_RESOURCE_RECEIVER_REQUIRED_MSG} Refused before approval.`,
      run.currentSession,
      undefined,
      "effective_resource_unresolved",
    );
  }

  // ── FS operation path (no session needed) ────────────────────────────────
  if (run.currentFsOp) {
    if (!yes) {
      const updatedTasks = updateTask(run.tasks, idx, t => ({ ...t, outcome: "rejected" as WorkflowTaskOutcome }));
      const display = buildDisplay(
        { ...run, tasks: updatedTasks },
        `Task ${idx + 1}: Rejected by H.`,
        { failureNote: "Task was rejected." },
      );
      return mk("task_failed", run, { currentFsOp: undefined, tasks: updatedTasks, display } as unknown as MkOverrides);
    }
    const display = buildDisplay(run, `Task ${idx + 1}: Approved. Executing operation.`);
    return mk("task_approved", run, { display });
  }

  // ── Session path ──────────────────────────────────────────────────────────
  if (!run.currentSession) return run;

  if (!yes) {
    // H rejected. Transition to task_failed with rejected outcome.
    let nextSession: WorkflowCurrentSession;
    if (run.currentSession.runtime === "cursor") {
      nextSession = { runtime: "cursor", state: reject(run.currentSession.state) };
    } else {
      nextSession = { runtime: "claude", state: rejectClaude(run.currentSession.state) };
    }
    const updatedTasks = updateTask(run.tasks, idx, t => ({ ...t, outcome: "rejected" as WorkflowTaskOutcome }));
    const display = buildDisplay(
      { ...run, tasks: updatedTasks },
      `Task ${idx + 1}: Rejected by H.`,
      { failureNote: "Task was rejected." },
    );
    return mk("task_failed", run, { currentSession: nextSession, tasks: updatedTasks, display });
  }

  // H approved. Call approve() only — NO delivery. (W2 proof point)
  let nextSession: WorkflowCurrentSession;
  if (run.currentSession.runtime === "cursor") {
    nextSession = { runtime: "cursor", state: approve(run.currentSession.state) };
  } else {
    nextSession = { runtime: "claude", state: approveClaude(run.currentSession.state) };
  }

  const display = buildDisplay(run, `Task ${idx + 1}: Approved. Ready to deliver.`);
  return mk("task_approved", run, { currentSession: nextSession, display });
}

// ─── deliverWorkflowTask ──────────────────────────────────────────────────────

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
export async function deliverWorkflowTask(
  run:      WorkflowRun,
  plugins:  WorkflowPlugins,
  storeDir: string,
  deps?:    ClaudeGateDeps,
  constitution?: {
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
  },
): Promise<WorkflowRun> {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_approved") return run;

  // Spec-hash invariant: the live spec must still match the hash recorded
  // at createWorkflowRun time. Re-checked here because deliverWorkflowTask
  // is the actual side-effect surface — anything that mutated the spec
  // between task_approved and delivery would otherwise execute against
  // an unapproved definition. (Row 2 of the SafeHarness Hardening Map.)
  const hashCheck = verifyWorkflowSpecHash(run.spec, run.workflowSpecHash);
  if (!hashCheck.ok) {
    return abortOnSpecHashMismatch(run, hashCheck.expected, hashCheck.actual);
  }

  // Constitution Materialization V1 (Article V, INV-COMP-2): re-verify the
  // Decision Basis fingerprint recorded at approval. Generalizes the spec-hash
  // check from Proposal-only to the full eight-class basis. Conditional so runs
  // built without a fingerprint (older/direct constructions) are unaffected.
  if (run.decisionBasisFingerprint) {
    const basisCheck = verifyDecisionBasisFingerprint(
      assembleDecisionBasis(run.spec, {
        repository: constitution?.repositoryProvenance ?? null,
      }),
      run.decisionBasisFingerprint,
    );
    if (!basisCheck.ok) {
      return abortOnDecisionBasisMismatch(run, basisCheck.expected, basisCheck.actual);
    }
  }

  const idx = run.currentIndex;
  const taskSpec = run.spec.tasks[idx];
  if (!taskSpec || !isDeliverableTaskSpec(taskSpec)) {
    throw new Error("Execution blocked: task spec is not deliverable");
  }

  // ── FS operation delivery path ────────────────────────────────────────────
  if (run.currentFsOp) {
    if (!plugins.fs) {
      return transitionToFailed(run, idx, "No filesystem plugin configured for this server.");
    }
    const result = await plugins.fs.executeFsOp(run.currentFsOp);

    const outcomeVerification = observeAndPersistFsOutcome({
      op: run.currentFsOp,
      executorReport: result.kind === "accepted" ? "accepted" : "failed",
      ...(result.detail !== undefined ? { executorDetail: result.detail } : {}),
      ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
      context: {
        storeDir,
        workflowRunId: run.workflowRunId,
        stepIndex: idx,
        ...(constitution?.workspaceRoot !== undefined
          ? { workspaceRoot: constitution.workspaceRoot }
          : {}),
        ...(constitution?.realityProbe !== undefined
          ? { realityProbe: constitution.realityProbe }
          : {}),
      },
    });

    if (result.kind === "accepted") {
      recordRuntimeLedgerEvent({
        prompt: taskSpec.input,
        outcome: "EXECUTES_AFTER_APPROVAL",
        reason: "Deterministic filesystem operation executed after approval.",
        notes: ["coordinator.deliverWorkflowTask.fs.accepted"],
      });
      const updatedTasks = updateTask(run.tasks, idx, t => ({
        ...t,
        outcome: "accepted" as WorkflowTaskOutcome,
        outcomeVerification,
      }));
      const nextIndex = idx + 1;
      const isDone    = nextIndex >= run.spec.tasks.length;
      const display   = buildDisplay(
        { spec: run.spec, tasks: updatedTasks, currentIndex: nextIndex },
        isDone
          ? `Workflow "${run.spec.name}" completed.`
          : `Task ${idx + 1}: Done. Advancing to task ${nextIndex + 1}.`,
      );
      return mk(
        isDone ? "completed" : "running",
        run,
        {
          tasks: updatedTasks,
          currentIndex: nextIndex,
          currentFsOp: undefined,
          currentSession: undefined,
          display,
          ...(run.currentFsOp.operationType === "run_command"
            ? {
                lastCommandResult: {
                  stdout: result.stdout ?? "",
                  stderr: result.stderr ?? "",
                  exitCode: result.exitCode ?? 0,
                },
              }
            : {}),
        } as unknown as MkOverrides,
      );
    }

    const failed = transitionToFailed(
      run,
      idx,
      result.detail ?? "Filesystem operation failed.",
      undefined,
      run.currentFsOp.operationType === "run_command"
        ? {
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
            exitCode: result.exitCode ?? 1,
          }
        : undefined,
      result.errorCode,
    );
    return {
      ...failed,
      tasks: updateTask(run.tasks, idx, t => ({ ...t, outcomeVerification })),
    };
  }

  // ── Session delivery path (existing) ─────────────────────────────────────
  if (!run.currentSession) return run;

  // ── Deliver via the correct plugin (W8 / Proof 3) ────────────────────────

  let nextSession: WorkflowCurrentSession;

  if (run.currentSession.runtime === "cursor") {
    const plugin = plugins.cursor;
    if (!plugin) {
      // No cursor plugin provided — block.
      return transitionToFailed(run, idx, "No cursor plugin provided for this task.");
    }
    const delivered = await deliver(run.currentSession.state, plugin, storeDir);
    nextSession = { runtime: "cursor", state: delivered };
  } else {
    const plugin = plugins.claude;
    if (!plugin) {
      return transitionToFailed(run, idx, "No claude plugin provided for this task.");
    }
    const delivered = await deliverClaude(run.currentSession.state, plugin, storeDir, deps);
    nextSession = { runtime: "claude", state: delivered };
  }

  const deliveredPhase = nextSession.state.phase;

  // ── Map delivery outcome ──────────────────────────────────────────────────

  if (deliveredPhase === "accepted") {
    recordRuntimeLedgerEvent({
      prompt: taskSpec.input,
      outcome: "EXECUTES_AFTER_APPROVAL",
      reason: "Task executed after approval through runtime delivery.",
      notes: ["coordinator.deliverWorkflowTask.session.accepted"],
    });
    // P3 Phase 2: when the delivery path parked on a model advisory and the
    // human explicitly proceeded despite it, stamp the durable supersession
    // relation (position ids) onto the task record. The referenced
    // ucp.model_advisory.v1 envelopes remain unaltered — both facts survive.
    const supersededIds =
      nextSession.runtime === "claude"
        ? (nextSession.state.supersededAdvisories ?? []).map(r => r.modelPositionId)
        : [];
    const retiredIds =
      nextSession.runtime === "claude"
        ? (nextSession.state.retiredAdvisories ?? []).map(r => r.record.modelPositionId)
        : [];
    // Record outcome and advance to next task.
    const updatedTasks = updateTask(run.tasks, idx, t => ({
      ...t,
      outcome: "accepted" as WorkflowTaskOutcome,
      outcomeVerification: unverifiedFromAccepted(),
      ...(supersededIds.length > 0 ? { supersededPositionIds: supersededIds } : {}),
      ...(retiredIds.length > 0 ? { retiredPositionIds: retiredIds } : {}),
    }));
    const nextIndex    = idx + 1;
    const isDone       = nextIndex >= run.spec.tasks.length;
    const display      = buildDisplay(
      { spec: run.spec, tasks: updatedTasks, currentIndex: nextIndex },
      isDone
        ? `Workflow "${run.spec.name}" completed.`
        : `Task ${idx + 1}: Accepted. Advancing to task ${nextIndex + 1}.`,
    );
    return mk(
      isDone ? "completed" : "running",
      run,
      { tasks: updatedTasks, currentIndex: nextIndex, currentSession: undefined, display } as unknown as MkOverrides,
    );
  }

  if (deliveredPhase === "scope_question") {
    // F9 / WF-S3: if taskSpec carries explicit targetFiles, auto-resolve scope.
    const taskSpec = run.spec.tasks[idx]!;
    if (taskSpec.targetFiles && taskSpec.targetFiles.length > 0) {
      const candidates: readonly string[] =
        nextSession.runtime === "cursor"
          ? (nextSession.state.scopeQuestion?.candidates ?? [])
          : (nextSession.state.scopeQuestion?.candidates ?? []);

      const match = taskSpec.targetFiles.find(tf => candidates.includes(tf));
      if (!match) {
        // WF-S1: explicit scope provided but no candidate matches — contradiction.
        return transitionToFailed(
          run, idx,
          `Scope contradiction: targetFiles [${taskSpec.targetFiles.join(", ")}] ` +
          `did not match any delivery candidates [${candidates.join(", ")}]. ` +
          `Verify that task input and targetFiles refer to the same file.`,
        );
      }

      // WF-S3: select the already-specified target, bind its receiver, and
      // return to task_ready. The proposal changed — H must approve again.
      const scopeRoot = constitution?.workspaceRoot;
      let answeredSession: WorkflowCurrentSession;
      if (nextSession.runtime === "cursor") {
        answeredSession = { runtime: "cursor", state: answerScope(nextSession.state, match, Date.now(), scopeRoot) };
      } else {
        answeredSession = { runtime: "claude", state: answerClaudeScope(nextSession.state, match, Date.now(), scopeRoot) };
      }

      if (answeredSession.state.phase === "exec_error") {
        return transitionToFailed(
          run,
          idx,
          answeredSession.state.display.headline || "Receiver identity could not be bound.",
          answeredSession,
          undefined,
          "effective_resource_unresolved",
        );
      }

      const autoDisplay = buildDisplay(run, `Task ${idx + 1}: Scope bound to ${match}. Fresh approval required.`);
      return mk("task_ready", run, {
        currentSession: answeredSession,
        display: autoDisplay,
      });
    }

    const display = buildDisplay(run, `Task ${idx + 1}: Scope clarification needed.`);
    return mk("task_scope", run, { currentSession: nextSession, display });
  }

  // P5 V1: retired-position reassertion — do NOT park. Session remains
  // approved; the reassertion is already persisted. The task stays at the
  // current index with no outcome change.
  if (deliveredPhase === "approved" && nextSession.runtime === "claude") {
    const display = buildDisplay(
      run,
      `Task ${idx + 1}: Retired model position reasserted — recorded, not standing.`,
    );
    return mk("task_approved", run, { currentSession: nextSession, display });
  }

  // P3 Phase 2: model advisory — PARK. The model emitted structured advisory
  // position(s) about the delivered action and did NOT execute. The task stays
  // at the current index with NO outcome change and NO advancement; execution
  // of the advised action happens only after an explicit human decision via
  // resolveWorkflowAdvisory. (Advisory-only responses never count as execution.)
  if (deliveredPhase === "advisory" && nextSession.runtime === "claude") {
    recordRuntimeLedgerEvent({
      prompt: taskSpec.input,
      outcome: "REVIEW_REQUIRED",
      reason: "Model emitted a structured advisory position; the action is parked pending an explicit human supersession decision.",
      notes: ["coordinator.deliverWorkflowTask.session.advisory"],
    });
    const display = buildDisplay(
      run,
      `Task ${idx + 1}: Model advisory — waiting on your decision.`,
    );
    return mk("task_advisory", run, { currentSession: nextSession, display });
  }

  // exec_error, blocked — surface as task_failed.
  // Consensus failures use human-friendly notes that distinguish capability
  // splits (feasibility issue) from policy blocks (governance disagreement).
  const rawNote = nextSession.state.display.resultNote ?? "Execution failed.";
  const note    = buildDeliveryFailureNote(nextSession, rawNote);
  return transitionToFailed(run, idx, note, nextSession);
}

// ─── answerWorkflowScope ──────────────────────────────────────────────────────

/**
 * Answer a scope clarification question for the current task.
 *
 * Valid from "task_scope" only.
 * Transitions to "task_ready" with a newly bound pending artifact.
 * H must approve again — the selected target changed the proposal.
 *
 * @param choiceIdx 1-based index into the scope candidates.
 *                  Out-of-range → returns state unchanged.
 */
export function answerWorkflowScope(
  run: WorkflowRun,
  choiceIdx: number,
  workspaceRoot?: string,
): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_scope" || !run.currentSession) return run;

  const candidates =
    run.currentSession.runtime === "cursor"
      ? (run.currentSession.state.scopeQuestion?.candidates ?? [])
      : (run.currentSession.state.scopeQuestion?.candidates ?? []);

  const file = candidates[choiceIdx - 1];
  if (!file) return run;  // Out of range — re-prompt.

  let nextSession: WorkflowCurrentSession;
  if (run.currentSession.runtime === "cursor") {
    nextSession = { runtime: "cursor", state: answerScope(run.currentSession.state, file, Date.now(), workspaceRoot) };
  } else {
    nextSession = { runtime: "claude", state: answerClaudeScope(run.currentSession.state, file, Date.now(), workspaceRoot) };
  }

  const idx = run.currentIndex;
  if (nextSession.state.phase === "exec_error") {
    return transitionToFailed(
      run,
      idx,
      nextSession.state.display.headline || "Receiver identity could not be bound.",
      nextSession,
      undefined,
      "effective_resource_unresolved",
    );
  }

  const display = buildDisplay(run, `Task ${idx + 1}: Scope bound to ${file}. Fresh approval required.`);
  return mk("task_ready", run, { currentSession: nextSession, display });
}

// ─── resolveWorkflowAdvisory (P3 Phase 2) ─────────────────────────────────────

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
export function resolveWorkflowAdvisory(
  run:     WorkflowRun,
  proceed: boolean,
): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_advisory" || !run.currentSession) return run;
  if (run.currentSession.runtime !== "claude") return run;

  const idx = run.currentIndex;

  if (!proceed) {
    const nextSession: WorkflowCurrentSession = {
      runtime: "claude",
      state:   rejectClaude(run.currentSession.state),
    };
    const updatedTasks = updateTask(run.tasks, idx, t => ({ ...t, outcome: "rejected" as WorkflowTaskOutcome }));
    const display = buildDisplay(
      { ...run, tasks: updatedTasks },
      `Task ${idx + 1}: Declined after model advisory.`,
      { failureNote: "Task was rejected after a model advisory." },
    );
    return mk("task_failed", run, { currentSession: nextSession, tasks: updatedTasks, display });
  }

  const nextSession: WorkflowCurrentSession = {
    runtime: "claude",
    state:   supersedeClaudeAdvisory(run.currentSession.state),
  };
  const display = buildDisplay(
    run,
    `Task ${idx + 1}: Proceeding despite the model advisory. Re-delivering.`,
  );
  return mk("task_approved", run, { currentSession: nextSession, display });
}

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
export function retireWorkflowAdvisory(
  run: WorkflowRun,
  input: RetireWorkflowAdvisoryInput,
  storeDir?: string,
): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_advisory" || !run.currentSession) return run;
  if (run.currentSession.runtime !== "claude") return run;

  const live = run.currentSession.state.advisoryPositions ?? [];
  if (live.length === 0) return run;
  if (
    input.mappedRelations !== undefined &&
    (input.authorityEvidenceStatus !== "portal_signed_verified" ||
      input.mappedRelations.length !== live.length)
  ) return run;

  const retirements: ModelRetirementRecord[] = [];
  for (const rec of live) {
    const mapped = input.mappedRelations?.find(
      (relation) =>
        relation.modelPositionId === rec.modelPositionId &&
        relation.positionHash === rec.evidenceEnvelopeId,
    );
    if (input.mappedRelations !== undefined && mapped === undefined) return run;
    const resolvingEvidenceIds =
      mapped !== undefined ? [mapped.evidenceBasisId] : input.resolvingEvidenceIds;
    const check = validateRetirementRequest({
      modelPositionId: rec.modelPositionId,
      positionHash: rec.evidenceEnvelopeId,
      resolvingEvidenceIds,
      livePositionIds: live.map((r) => r.modelPositionId),
    });
    if (!check.ok) return run;

    const groundsId = groundsIdFromBasis(rec.position.artifactId, rec.evidenceBasis);
    const envelope = createModelPositionRetirementEnvelope(
      {
        modelPositionId: rec.modelPositionId,
        positionHash: rec.evidenceEnvelopeId,
        resolvingEvidenceIds: [...resolvingEvidenceIds],
        ...(mapped !== undefined
          ? {
              mappedEvidence: {
                contract: "retirement_basis_relation.v1",
                evidenceBasisId: mapped.evidenceBasisId,
                evidenceBasisHash: mapped.evidenceBasisHash,
              },
            }
          : {}),
        groundsId,
        artifactId: rec.position.artifactId,
        decisionRelation: "retire_model_position",
        decidedAt: Date.now(),
        authorityEvidenceStatus: input.authorityEvidenceStatus,
        workflowRunId: run.workflowRunId,
        stepIndex: run.currentIndex,
        ...(input.authorityDecisionId !== undefined
          ? { authorityDecisionId: input.authorityDecisionId }
          : {}),
      },
      { parentId: rec.evidenceEnvelopeId },
    );
    if (storeDir !== undefined) {
      try {
        persistEnvelope(storeDir, envelope);
      } catch {
        // best-effort: in-memory retirement still holds for this session
      }
    }
    retirements.push({
      record: rec,
      groundsId,
      resolvingEvidenceIds,
      retirementEnvelopeId: envelope.id,
      authorityEvidenceStatus: input.authorityEvidenceStatus,
      ...(mapped !== undefined ? { mappedRelation: mapped } : {}),
    });
  }

  const nextSession: WorkflowCurrentSession = {
    runtime: "claude",
    state:   retireClaudeAdvisory(run.currentSession.state, retirements),
  };
  const display = buildDisplay(
    run,
    `Task ${run.currentIndex + 1}: Model position retired on named evidence. Re-delivering.`,
  );
  return mk("task_approved", run, { currentSession: nextSession, display });
}

// ─── applyFailureAction ───────────────────────────────────────────────────────

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
export function applyFailureAction(
  run:    WorkflowRun,
  action: "stop" | "skip" | "retry",
): WorkflowRun {
  if (isWorkflowTerminal(run)) return run;
  if (run.phase !== "task_failed") return run;

  const idx = run.currentIndex;

  if (action === "stop") {
    const updatedTasks = updateTask(run.tasks, idx, t => ({ ...t, outcome: "stopped" as WorkflowTaskOutcome }));
    const display = buildDisplay(
      { ...run, tasks: updatedTasks },
      `Workflow "${run.spec.name}" stopped at task ${idx + 1}.`,
    );
    return mk("stopped", run, { tasks: updatedTasks, currentSession: undefined, display } as unknown as MkOverrides);
  }

  if (action === "skip") {
    const updatedTasks = updateTask(run.tasks, idx, t => ({ ...t, outcome: "skipped" as WorkflowTaskOutcome }));
    const nextIndex    = idx + 1;
    const isDone       = nextIndex >= run.spec.tasks.length;
    const display      = buildDisplay(
      { spec: run.spec, tasks: updatedTasks, currentIndex: nextIndex },
      isDone
        ? `Workflow "${run.spec.name}" completed (task ${idx + 1} skipped).`
        : `Task ${idx + 1} skipped. Advancing to task ${nextIndex + 1}.`,
    );
    return mk(
      isDone ? "completed" : "running",
      run,
      { tasks: updatedTasks, currentIndex: nextIndex, currentSession: undefined, display } as unknown as MkOverrides,
    );
  }

  // retry
  const currentTask = run.tasks[idx];
  if (!currentTask) return run;

  if (currentTask.retryCount >= maxRetries(run)) {
    // Max retries exceeded — only stop/skip are valid. Return unchanged.
    return run;
  }

  const updatedTasks = updateTask(run.tasks, idx, t => ({
    ...t,
    retryCount: t.retryCount + 1,
    outcome:    "pending" as WorkflowTaskOutcome,
    // Clear provenance IDs — new session will set new ones.
  }));

  const display = buildDisplay(
    { spec: run.spec, tasks: updatedTasks, currentIndex: idx },
    `Task ${idx + 1}: Retrying (attempt ${currentTask.retryCount + 2}).`,
  );

  // W3: session is cleared. advanceWorkflow will create a new one.
  return mk("running", run, { tasks: updatedTasks, currentSession: undefined, display } as unknown as MkOverrides);
}

// ─── UCP workflow run provenance ──────────────────────────────────────────────

/**
 * buildWorkflowRunPayload — produce the UCP payload for ucp.workflow_run.v1.
 *
 * Called when the workflow reaches "completed" or "stopped" (W5).
 * Not called for in-progress runs.
 *
 * @throws {Error} If run is not in a terminal phase.
 */
export function buildWorkflowRunPayload(run: WorkflowRun): WorkflowRunPayload {
  if (run.phase !== "completed" && run.phase !== "stopped") {
    throw new Error(
      `buildWorkflowRunPayload: run must be terminal, got "${run.phase}"`,
    );
  }
  const finalOutcome: "completed" | "stopped" =
    run.phase === "completed" ? "completed" : "stopped";

  const acceptedCount = run.tasks.filter(t => t.outcome === "accepted").length;
  const skippedCount  = run.tasks.filter(t =>
    t.outcome === "skipped" || t.outcome === "skipped_by_intake",
  ).length;

  type SessionRefOutcome =
    | "accepted"
    | "skipped"
    | "skipped_by_intake"
    | "planning_reviewed"
    | "stopped"
    | "rejected";
  const sessionRefs = run.tasks
    .filter(t => t.outcome !== "pending")
    .map(t => ({
      taskIndex:  t.index,
      outcome:    t.outcome as SessionRefOutcome,
      retryCount: t.retryCount,
      ...(t.intentId   ? { intentId:   t.intentId   } : {}),
      ...(t.responseId ? { responseId: t.responseId } : {}),
      // P3 Phase 2: carry the durable supersession relation, when present.
      ...(t.supersededPositionIds && t.supersededPositionIds.length > 0
        ? { supersededPositionIds: [...t.supersededPositionIds] }
        : {}),
      ...(t.retiredPositionIds && t.retiredPositionIds.length > 0
        ? { retiredPositionIds: [...t.retiredPositionIds] }
        : {}),
    }));

  return {
    workflowRunId: run.workflowRunId,
    ...(run.executionInstanceId !== undefined
      ? { executionInstanceId: run.executionInstanceId }
      : {}),
    workflowName:  run.spec.name,
    finalOutcome,
    taskCount:     run.spec.tasks.length,
    acceptedCount,
    skippedCount,
    taskInputs:    run.spec.tasks.map(t => t.input),
    sessionRefs,
  };
}

/**
 * persistWorkflowRun — build a ucp.workflow_run.v1 envelope and persist it.
 *
 * This is fire-and-forget (uses persistEnvelope, not persistEnvelopeOrThrow).
 * A persistence failure must NOT block the shell from rendering a terminal
 * state to the user. The UCP record is an audit artifact, not a gate.
 *
 * @throws {Error} If run is not terminal. Call only after isWorkflowTerminal(run).
 */
export function persistWorkflowRun(run: WorkflowRun, storeDir: string): void {
  const snapshot = buildWorkflowRunPayload(run);
  // Ordinals order distinct snapshots, not calls to the persistence function.
  // Preserve an existing snapshot byte-for-byte, even after another run.
  const identity = stableStringify(snapshot);
  for (const existing of listWorkflowRunEnvelopes(storeDir)) {
    const { executionOrdinal: _ordinal, ...persistedSnapshot } = existing.payload;
    if (stableStringify(persistedSnapshot) === identity) return;
  }
  const payload = {
    ...snapshot,
    executionOrdinal: nextExecutionOrdinal(storeDir),
  };
  const envelope = createWorkflowRunEnvelope(payload);
  persistEnvelope(storeDir, envelope);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when a Claude delivery failed due to any consensus policy.
 * Only Claude sessions can carry consensus results.
 */
function isConsensusFailure(session: WorkflowCurrentSession): boolean {
  if (session.runtime !== "claude") return false;
  const result = session.state.executionResult;
  if (result?.kind !== "refused_due_to_execution_error") return false;
  return (
    result.errorCode === "consensus_no_quorum" ||
    result.errorCode === "consensus_capability_split" ||
    result.errorCode === "consensus_timeout"
  );
}

/**
 * Returns true when the consensus failure was a capability split:
 * primary accepted, secondary had execution_error (feasibility issue, not safety).
 */
function isCapabilitySplit(session: WorkflowCurrentSession): boolean {
  if (session.runtime !== "claude") return false;
  const result = session.state.executionResult;
  return (
    result?.kind      === "refused_due_to_execution_error" &&
    result?.errorCode === "consensus_capability_split"
  );
}

/**
 * Builds a human-friendly failure note based on the type of delivery failure.
 * Distinguishes capability splits (feasibility) from governance blocks (safety).
 */
function buildDeliveryFailureNote(session: WorkflowCurrentSession, rawNote: string): string {
  if (!isConsensusFailure(session)) return rawNote;
  if (isCapabilitySplit(session)) {
    return (
      "capability_split: One model processed this successfully. " +
      "A second check couldn\u2019t complete the request \u2014 this appears to be a " +
      "capability issue, not a safety concern. You can retry or skip this step."
    );
  }
  return (
    "I couldn\u2019t confidently apply this change. " +
    "The safety check didn\u2019t confirm it across models. " +
    "You can retry or skip this step."
  );
}

function transitionToFailed(
  run:          WorkflowRun,
  idx:          number,
  failureNote:  string,
  nextSession?: WorkflowCurrentSession,
  commandResult?: { stdout: string; stderr: string; exitCode: number },
  errorCode?:   WorkflowDisplayErrorCode,
): WorkflowRun {
  const display = buildDisplay(
    run,
    `Task ${idx + 1}: Failed.`,
    { failureNote, ...(errorCode !== undefined ? { errorCode } : {}) },
  );
  return mk("task_failed", run, {
    ...(nextSession !== undefined ? { currentSession: nextSession } : {}),
    ...(commandResult !== undefined ? { lastCommandResult: commandResult } : {}),
    display,
  });
}
