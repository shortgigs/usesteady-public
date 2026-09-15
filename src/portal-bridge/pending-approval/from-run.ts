/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - run -> input mapper.
 *
 * Pure, read-only projection of a WorkflowRun at a pre-execution approval gate into
 * the normalized `PendingApprovalInput` the builder consumes. No network, no
 * filesystem, no clock (the gate-open timestamp is injected), no env reads.
 *
 * Source of truth (INV-LA-EMIT1 / privacy INV-PAB-P2): the same structured
 * `WorkflowTaskSpec` fields the executor consumes and the local SYSTEM WILL preview
 * renders from - `operationType`, `targetFiles`, `newPath`, `structuredReplace`,
 * plus `run.display.headline`. This guarantees the Portal gate cannot drift from
 * what the local operator would see. There is deliberately NO path here for file
 * contents or diffs to reach the wire - only a summary line, resource PATHS +
 * change-types, and a Core-assigned risk band.
 *
 * The risk band and action_type are deterministic, monotone maps of the structured
 * operation type - fixed strings, never derived from or paraphrasing user input.
 */

import type { WorkflowRun, WorkflowTaskSpec } from "../../workflow/types.js";
import type {
  PendingActionType,
  PendingAffectedResource,
  PendingApprovalInput,
  PendingApprovalRisk,
  ResourceChangeType,
} from "./payload.js";

/** Fixed map: structured op -> coarse action class. Never paraphrases input. */
function actionTypeFor(op: WorkflowTaskSpec["operationType"]): PendingActionType {
  switch (op) {
    case "create_dir":
    case "write_file":
      return "create";
    case "delete_file":
      return "delete";
    case "rename":
      return "rename";
    case "replace":
    case "append_file":
    case "prepend_file":
      return "update";
    case "run_command":
    case undefined:
      return "other";
  }
}

/**
 * Fixed map: structured op -> Core-assigned risk band. Monotone and conservative:
 * destructive / arbitrary-shell ops are high, moves are medium, in-place text edits
 * are low, and an unresolved (NL, no structured op) gate defaults to medium so the
 * absence of structure is never read as "safe".
 */
function riskFor(op: WorkflowTaskSpec["operationType"]): PendingApprovalRisk {
  switch (op) {
    case "delete_file":
    case "run_command":
      return "high";
    case "rename":
    case "write_file":
      return "medium";
    case "replace":
    case "append_file":
    case "prepend_file":
    case "create_dir":
      return "low";
    case undefined:
      return "medium";
  }
}

/** change_type for a resource entry; "other" action types carry no resources. */
function changeTypeFor(action: PendingActionType): ResourceChangeType | null {
  return action === "other" ? null : action;
}

function affectedResourcesFor(
  task: WorkflowTaskSpec,
  action: PendingActionType,
): readonly PendingAffectedResource[] | undefined {
  const changeType = changeTypeFor(action);
  if (changeType === null) return undefined; // run_command / unresolved: no file resource

  // Prefer the most specific path the structured fields expose, in priority order:
  // structuredReplace.filePath -> newPath (rename target) -> targetFiles[0].
  const path =
    task.structuredReplace?.filePath ??
    task.newPath ??
    (task.targetFiles && task.targetFiles.length > 0 ? task.targetFiles[0] : undefined);

  if (path === undefined || path.trim().length === 0) return undefined;
  return [{ path, change_type: changeType }];
}

/**
 * Build a non-empty SYSTEM WILL summary. The run's display headline is the same
 * deterministic line shown to the local operator at the approval frame; it is the
 * preferred summary so the Portal and the CLI never disagree. Falls back to the
 * task's own label / verbatim input (user-authored text, never an AI paraphrase)
 * and finally to a fixed string, so the contract's "non-empty summary" invariant
 * always holds.
 *
 * P3 Phase 2 (phase-aware): at a "task_advisory" gate the run headline describes
 * the advisory episode, not the action — so the summary is derived from the
 * STABLE taskSpec fields (label / input slice) instead, keeping the signed
 * decision basis bound to the exact same action across gate cycles.
 */
function summaryFor(run: WorkflowRun, task: WorkflowTaskSpec): string {
  if (run.phase === "task_advisory") {
    const label = task.label?.trim();
    if (label && label.length > 0) return label;
    const input = task.input.trim();
    if (input.length > 0) return input.slice(0, 60);
    return "Approve pending step";
  }
  const headline = run.display.headline.trim();
  if (headline.length > 0) return headline;
  const label = task.label?.trim();
  if (label && label.length > 0) return label;
  const input = task.input.trim();
  if (input.length > 0) return input.slice(0, 200);
  return "Approve pending step";
}

/**
 * Project the run's CURRENT gate into a PendingApprovalInput. Returns null when the
 * run has no current task spec (defensive: the caller then falls back to the local
 * approval flow rather than emitting a malformed gate). `requestedAt` is the
 * injected Core-clock gate-open timestamp (ISO-8601; ordering authority INV-PAB-I4).
 */
export function pendingApprovalInputFromRun(
  run: WorkflowRun,
  requestedAt: string,
): PendingApprovalInput | null {
  const task = run.spec.tasks[run.currentIndex];
  if (!task) return null;

  const actionType = actionTypeFor(task.operationType);
  const resources = affectedResourcesFor(task, actionType);

  // P3 Phase 2: at a parked advisory gate, carry the exact preserved model
  // positions (content id + evidence envelope id + verbatim content) and the
  // gate cycle (advisory episode count) so the Portal stores a distinct gate
  // row and the supersession decision binds to the positions.
  const session = run.currentSession;
  const advisoryRecords =
    run.phase === "task_advisory" && session?.runtime === "claude"
      ? (session.state.advisoryPositions ?? [])
      : [];
  const advisoryCycle =
    run.phase === "task_advisory" && session?.runtime === "claude"
      ? (session.state.advisoryCycle ?? 1)
      : 0;
  const advisoryPairs = new Set<string>();
  const advisoryIds = new Map<string, string>();
  for (const record of advisoryRecords) {
    const pair = `${record.modelPositionId}:${record.evidenceEnvelopeId}`;
    if (advisoryPairs.has(pair)) {
      throw new Error("duplicate advisory O pair escaped delivery producer");
    }
    advisoryPairs.add(pair);
    const previous = advisoryIds.get(record.modelPositionId);
    if (previous !== undefined && previous !== record.evidenceEnvelopeId) {
      throw new Error("conflicting advisory envelope identity escaped delivery producer");
    }
    advisoryIds.set(record.modelPositionId, record.evidenceEnvelopeId);
  }

  return {
    runId: run.workflowRunId,
    stepIndex: run.currentIndex,
    workflowName: run.spec.name ?? null,
    summary: summaryFor(run, task),
    actionType,
    ...(resources ? { affectedResources: resources } : {}),
    risk: riskFor(task.operationType),
    requestedBy: null,
    requestedAt,
    ...(advisoryRecords.length > 0
      ? {
          modelAdvisories: advisoryRecords.map((r) => ({
            modelPositionId: r.modelPositionId,
            positionHash:    r.evidenceEnvelopeId,
            kind:            r.position.kind,
            explanation:     r.position.explanation,
            artifactId:      r.position.artifactId,
            // P4: carry the system-derived evidence basis when the gate
            // attached one (P4-era deliveries). Legacy (pre-P4) records have
            // none — the field is omitted, never synthesized here.
            ...(r.evidenceBasis !== undefined
              ? {
                  evidenceBasis: {
                    derivation: r.evidenceBasis.derivation,
                    sources: r.evidenceBasis.sources,
                    evidenceBackedContradiction: r.evidenceBasis.evidenceBackedContradiction,
                    comprehension: r.evidenceBasis.comprehension,
                  },
                }
              : {}),
            ...(r.evidenceBasisEnvelopeId !== undefined
              ? { evidenceBasisId: r.evidenceBasisEnvelopeId }
              : {}),
            ...(r.evidenceBasisEnvelopeId !== undefined &&
            r.evidenceBasisEnvelopeHash !== undefined
              ? {
                  evidenceBasisRef: {
                    evidenceBasisId: r.evidenceBasisEnvelopeId,
                    evidenceBasisHash: r.evidenceBasisEnvelopeHash,
                  },
                }
              : {}),
          })),
        }
      : {}),
    ...(advisoryCycle > 0 ? { gateCycle: advisoryCycle } : {}),
  };
}
