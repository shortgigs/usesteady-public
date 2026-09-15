/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - run -> input mapping.
 *
 * Turns a finished Core run (its execution.db session + persisted UCP chain) into
 * the camel-case `ExecutionReturnInput` consumed by buildExecutionReturnPayload.
 *
 * Shape of this slice (P0-49 Step 2a):
 *   - `summarizeDecisions` and `stepsToAffectedResources` are PURE (no I/O).
 *     Feature 2.2: step status is a pre-execution human decision, not execution.
 *   - `mapRunToExecutionReturnInput` is the thin, READ-ONLY orchestrator: it
 *     reads (never writes) execution.db via getSessionSteps and the UCP chain via
 *     getChain. It performs no network call and does not touch the run.
 *
 * Caller-supplied metadata (`RunReturnMetadata`) carries the facts execution.db
 * does not hold: the Core-generated run_id, the UCP linkage, outcome + clock,
 * approval record, break-glass flag, resume-token presence, and an optional
 * redaction policy (applied on the machine before the resources are returned -
 * INV-ERB-P3).
 */

import { getSessionSteps } from "../../execution/session-db.js";
import { getChain } from "../../ucp/persistence/query.js";
import { computeChainVerification } from "../../ucp/chain-verification.js";
import type { ExecutionStep } from "../../types/execution.js";
import type { ExecutionReturnInput } from "./build-payload.js";
import { redactAffectedResources, type RedactionPolicy } from "./redact.js";
import type {
  ApprovalMode,
  ExecutionOutcome,
  ExecutionReturnAffectedResource,
  ExecutionReturnDecisionSummary,
  ExecutionReturnReplayRef,
  ExecutionReturnResumeTokenMeta,
} from "./types.js";

/** Minimal step shape the pure helpers depend on (decoupled from full ExecutionStep). */
export type DecisionStep = Pick<ExecutionStep, "status" | "file_path" | "action_type">;

/**
 * Counts-only decision summary from execution.db step statuses.
 * Those statuses are pre-execution human decision records:
 *   approved  = explicit human approval
 *   rejected  = explicit human rejection
 *   executed  = always 0 / not_established (unknown-by-this-field, not
 *               proof of non-execution — this review layer has not run files)
 *   skipped   = 0 / not_available (pending is not a human skip)
 */
export function summarizeDecisions(
  steps: readonly DecisionStep[],
  breakGlass: boolean,
): ExecutionReturnDecisionSummary {
  let approved = 0;
  let rejected = 0;

  for (const s of steps) {
    if (s.status === "approved") {
      approved += 1;
    } else if (s.status === "rejected") {
      rejected += 1;
    }
  }

  return {
    total_steps: steps.length,
    approved,
    rejected,
    executed: 0,
    skipped: 0,
    break_glass: breakGlass,
    approved_basis: "explicit_human_decision",
    rejected_basis: "explicit_human_decision",
    executed_basis: "not_established",
    skipped_basis: "not_available",
  };
}

/**
 * execution.db is a pre-execution review layer. Approved steps have not run,
 * so they must not become affected_resources. Always empty.
 */
export function stepsToAffectedResources(
  _steps: readonly DecisionStep[],
): ExecutionReturnAffectedResource[] {
  return [];
}

export type RunReturnMetadata = {
  /** Core-generated idempotency anchor (INV-ERB-I1). */
  readonly runId: string;
  readonly ucpRootId: string;
  readonly ucpBundleHash?: string | null;
  readonly workflowName?: string | null;
  readonly outcome: ExecutionOutcome;
  /** ISO-8601, Core clock - ordering authority (INV-ERB-I3). */
  readonly executedAt: string;
  readonly approval: {
    readonly mode: ApprovalMode;
    readonly approver: string | null;
    readonly approvedAt: string | null;
    /** P1 authority carry (optional): evidence status + preserved assertion. */
    readonly authorityStatus?: "portal_signed_verified" | "self_asserted";
    readonly authorityAssertion?: unknown;
  };
  readonly breakGlass?: boolean;
  readonly resumeTokenMeta?: ExecutionReturnResumeTokenMeta;
  /** Optional on-machine redaction applied before resources leave (INV-ERB-P3). */
  readonly redaction?: RedactionPolicy;
  /** Optional (P0-55) kernel-replay reference; omitted from the wire when null. */
  readonly replayRef?: ExecutionReturnReplayRef | null;
};

/**
 * Read-only mapping from a finished run to ExecutionReturnInput.
 * Reads execution.db (steps) and the UCP chain (chain count). No writes, no
 * network. The returned input is ready for buildExecutionReturnPayload.
 */
export function mapRunToExecutionReturnInput(
  storeDir: string,
  sessionId: string,
  meta: RunReturnMetadata,
): ExecutionReturnInput {
  const steps = getSessionSteps(storeDir, sessionId);
  const breakGlass = meta.breakGlass ?? false;

  const decisionSummary = summarizeDecisions(steps, breakGlass);

  const { kept } = redactAffectedResources(
    stepsToAffectedResources(steps),
    meta.redaction,
  );

  // Read the chain once: its length feeds chain_ref.count, and its ordered ids
  // feed the P0-57 chain_verification digest (shared algorithm — never drifts from
  // the provenance endpoint). Content-hash ids only; no envelope bodies (INV-ERB-P2).
  const chain = getChain(storeDir, meta.ucpRootId);
  const chainCount = chain.length;
  const chainVerification = computeChainVerification(chain.map((env) => env.id));

  return {
    runId: meta.runId,
    ucpRootId: meta.ucpRootId,
    ucpBundleHash: meta.ucpBundleHash ?? null,
    workflowName: meta.workflowName ?? null,
    outcome: meta.outcome,
    executedAt: meta.executedAt,
    decisionSummary,
    approvalRecord: {
      mode: meta.approval.mode,
      approver: meta.approval.approver,
      approved_at: meta.approval.approvedAt,
      ...(meta.approval.authorityStatus
        ? { authority_status: meta.approval.authorityStatus }
        : {}),
      ...(meta.approval.authorityAssertion !== undefined &&
        meta.approval.authorityAssertion !== null
        ? { authority_assertion: meta.approval.authorityAssertion }
        : {}),
    },
    affectedResources: kept,
    ...(meta.resumeTokenMeta ? { resumeTokenMeta: meta.resumeTokenMeta } : {}),
    ...(meta.replayRef ? { replayRef: meta.replayRef } : {}),
    ...(chainVerification ? { chainVerification } : {}),
    chainCount,
  };
}
