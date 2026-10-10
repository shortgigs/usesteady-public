/**
 * Workflow spec deterministic hash.
 *
 * Computes a deterministic SHA-256 hex digest over the canonical JSON
 * representation of a WorkflowSpec. The hash is computed once at spec
 * load time (createWorkflowRun) and re-validated before each execution
 * advancement (advanceWorkflow, deliverWorkflowTask). Any mismatch
 * aborts the workflow.
 *
 * ── Threat covered ───────────────────────────────────────────────────────────
 *
 *   The WorkflowRun keeps a reference to the WorkflowSpec object the
 *   operator approved at "reviewing" time. If that spec object is mutated
 *   after approval — by accident, by another piece of code, or by a bug
 *   that aliases two specs — the coordinator would continue executing
 *   against the mutated definition without the operator's knowledge.
 *
 *   With this hash, every forward transition in the coordinator first
 *   recomputes the hash from the live spec and compares it to the hash
 *   stored on the run at creation time. A mismatch is fail-closed: the
 *   workflow aborts to "stopped" with a clear failure note.
 *
 * ── Determinism contract ─────────────────────────────────────────────────────
 *
 *   - Field order is fixed by this module, not by object construction
 *     order. Two specs with identical content but different key insertion
 *     order produce identical hashes.
 *   - Optional fields normalize to `null` so {} and {x: undefined} hash
 *     identically.
 *   - Readonly arrays are spread to plain arrays for stable serialization.
 *   - SHA-256 is purely local (node:crypto). No network. No external trust.
 *   - The hash value is a 64-char lowercase hex string.
 *
 * ── What this module is NOT ──────────────────────────────────────────────────
 *
 *   - NOT a cryptographic signing system (no keys, no signatures).
 *   - NOT a distributed trust system (purely local, single-process).
 *   - NOT a runtime network dependency (no I/O beyond local hash).
 *   - NOT an approval-semantics change (does not introduce new approval
 *     states; mismatch is treated as a hard abort, not a pending review).
 */

import { createHash } from "node:crypto";
import type { WorkflowSpec, WorkflowTaskSpec } from "./types.js";
import type { WorkPlan, WorkPlanTask } from "./work-plan-types.js";

// ─── Canonical payload shape ─────────────────────────────────────────────────

/**
 * Canonical, hash-stable representation of a single task spec.
 *
 * Field order is fixed; all optional fields normalize to `null` so that
 * absent / undefined / defaulted values produce identical canonical forms.
 */
function canonicalWorkPlanTaskPayload(task: WorkPlanTask): unknown {
  return {
    id:              task.id,
    action:          task.action,
    target:          task.target,
    outcome:         task.outcome,
    operatorAction:  task.operatorAction,
    sourceSpan:      task.sourceSpan,
    status:          task.status,
    evidenceLevel:   task.evidenceLevel,
    precondition:    task.precondition ?? null,
  };
}

function canonicalWorkPlanPayload(plan: WorkPlan): unknown {
  return {
    goal:                plan.goal,
    sourceContractRef:   plan.sourceContractRef,
    tasks:               plan.tasks.map(canonicalWorkPlanTaskPayload),
    nextAction:          plan.nextAction,
    terminalOutcome:     plan.terminalOutcome,
    trustClass:          plan.trustClass,
    deliverableType:     plan.deliverableType,
    planHash:            plan.planHash,
  };
}

function canonicalTaskPayload(task: WorkflowTaskSpec): unknown {
  return {
    input:             task.input,
    runtime:           task.runtime           ?? null,
    label:             task.label             ?? null,
    targetFiles:       task.targetFiles ? [...task.targetFiles] : null,
    operationType:     task.operationType     ?? null,
    content:           task.content           ?? null,
    newPath:           task.newPath           ?? null,
    command:           task.command           ?? null,
    structuredReplace: task.structuredReplace
      ? {
          oldValue: task.structuredReplace.oldValue,
          newValue: task.structuredReplace.newValue,
          filePath: task.structuredReplace.filePath,
        }
      : null,
    planningReview:  task.planningReview ?? null,
  };
}

/**
 * Canonical, hash-stable representation of a workflow spec.
 *
 * Field order is fixed by this function. Two specs with identical content
 * but different construction order produce identical canonical strings.
 */
function canonicalSpecPayload(spec: WorkflowSpec): string {
  const payload = {
    name:           spec.name,
    tasks:          spec.tasks.map(canonicalTaskPayload),
    defaultRuntime: spec.defaultRuntime ?? null,
    ocdOverride:    spec.ocdOverride
      ? { additionalProhibitedGlobs: [...spec.ocdOverride.additionalProhibitedGlobs] }
      : null,
    maxRetries:              spec.maxRetries ?? null,
    planningReviewHeadline:  spec.planningReviewHeadline ?? null,
    workPlan:                spec.workPlan ? canonicalWorkPlanPayload(spec.workPlan) : null,
  };
  return JSON.stringify(payload);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the deterministic SHA-256 hex digest of a WorkflowSpec.
 *
 * Same spec content → same hash on every host, every run.
 *
 * @param spec  The WorkflowSpec to hash.
 * @returns     A 64-character lowercase hex string (full SHA-256).
 */
export function computeWorkflowSpecHash(spec: WorkflowSpec): string {
  const canonical = canonicalSpecPayload(spec);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verification result for a workflow spec hash check.
 *
 * On mismatch, the result carries both the expected and actual digests
 * so failure messages can name the specific divergence.
 */
export type WorkflowSpecHashVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly expected: string; readonly actual: string };

/**
 * Verify that a live WorkflowSpec still produces the hash recorded at
 * spec-load time. Returns `{ ok: true }` on match; `{ ok: false, ... }`
 * with both digests on mismatch.
 *
 * Pure: no side effects, no I/O. Caller decides what to do on mismatch.
 *
 * @param spec    The live (possibly mutated) spec to recompute against.
 * @param expected The hash recorded at createWorkflowRun time.
 */
export function verifyWorkflowSpecHash(
  spec:     WorkflowSpec,
  expected: string,
): WorkflowSpecHashVerification {
  const actual = computeWorkflowSpecHash(spec);
  if (actual === expected) return { ok: true };
  return { ok: false, expected, actual };
}
