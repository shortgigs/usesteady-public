/**
 * UseSteady internal Agent SDK — captureApproval (Phase 5, slice 5-2).
 *
 * Stage 4 of the pipeline (Approval). This is the FIRST production wiring of
 * `recordApprovalBasis`: it persists an `ApprovalRecord` bound to the plan's
 * Decision Basis fingerprint. It is a decision-provenance capture, NOT an
 * authority grant and NOT an execution trigger:
 *
 *   - It writes ONLY the append-only constitution approvals JSONL (a decision
 *     record), never the workspace.
 *   - It does not create a run, advance a phase, or call any executor.
 *   - The coordinator's `advanceWorkflow` independently re-verifies the run's own
 *     fingerprint at the execution side-effect surface, so the ApprovalRecord is
 *     provenance, never an authorization token the gate consumes. The SDK cannot
 *     be a bypass.
 */

import {
  ApprovalRecordError,
  assembleDecisionBasis,
  recordApprovalBasis,
  verifyDecisionBasisFingerprint,
  type ApprovalRecord,
} from "../constitution/index.js";
import type {
  SdkApprovalRequest,
  SdkApprovalResult,
  SdkPlan,
} from "./types.js";

/**
 * Re-verify that a plan's Decision Basis still hashes to the recorded
 * fingerprint. Pure; the caller decides what to do on mismatch.
 */
export function verifyPlanFingerprint(plan: SdkPlan) {
  return verifyDecisionBasisFingerprint(plan.decisionBasis, plan.decisionBasisFingerprint);
}

/**
 * Capture an approval bound to the plan's fingerprint. Refuses a plan that was
 * blocked by safety (no approval can bind to a blocked proposal) — a record-
 * integrity guard, not an authority decision. Re-verifies the fingerprint before
 * persisting (defense in depth), then appends one record via recordApprovalBasis.
 */
export function captureApproval(req: SdkApprovalRequest): SdkApprovalResult {
  const { plan, storeDir } = req;

  if (plan.safety.verdict === "block") {
    throw new ApprovalRecordError(
      "approval_record_invalid",
      "Cannot approve a proposal blocked by safety.",
    );
  }

  // Defense in depth: confirm the carried fingerprint still matches the basis
  // (guards against an out-of-band mutation of plan.decisionBasis). The SDK is
  // spec-only by construction (planProposal passes repository: null), so we
  // reassemble with repository: null deliberately — if repository provenance is
  // ever reintroduced upstream without threading it through createWorkflowRun +
  // advanceWorkflow, this re-check FAILS LOUD here rather than persisting a
  // record that silently no longer binds to the host's run.
  const reassembled = assembleDecisionBasis(plan.spec, { repository: null });
  const verification = verifyDecisionBasisFingerprint(
    reassembled,
    plan.decisionBasisFingerprint,
  );
  if (!verification.ok) {
    throw new ApprovalRecordError(
      "approval_record_invalid",
      `Decision Basis fingerprint mismatch (expected ${verification.expected}, got ${verification.actual}).`,
    );
  }

  const record: ApprovalRecord = {
    workflowRunId: plan.workflowRunId,
    decisionBasisFingerprint: plan.decisionBasisFingerprint,
    capturedAt: req.capturedAt ?? new Date().toISOString(),
  };

  recordApprovalBasis(record, storeDir);
  return { record, verification };
}
