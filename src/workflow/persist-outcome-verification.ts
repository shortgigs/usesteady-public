/**
 * P6 V1 — observe and persist X → O → R after a workflow FS delivery.
 * Append-only. Does not mutate the executor report.
 */

import { makeFsRealityProbe } from "../governed-decision/stages/fs-reality-probe.js";
import type { RealityProbe } from "../governed-decision/stages/observation.js";
import type { FsChange } from "../understand/interpretation/types.js";
import {
  createExecutorReportEnvelope,
  createOutcomeObservationEnvelope,
  createOutcomeReconciliationEnvelope,
} from "../ucp/envelope.js";
import { persistEnvelope } from "../ucp/persistence/index.js";
import {
  executionPayloadForApprovedOp,
  fsChangeTargetPath,
  fsChangeToExecutableOp,
  reconcileOutcome,
  runIndependentProbe,
  type ExecutorReportKind,
  type OutcomeVerification,
} from "./outcome-verification.js";

export type OutcomeVerificationContext = {
  readonly workspaceRoot?: string;
  readonly realityProbe?: RealityProbe;
  readonly storeDir: string;
  readonly workflowRunId: string;
  readonly stepIndex: number;
};

export function observeAndPersistFsOutcome(input: {
  readonly op: FsChange;
  readonly executorReport: ExecutorReportKind;
  readonly executorDetail?: string;
  readonly errorCode?: string;
  readonly context: OutcomeVerificationContext;
}): OutcomeVerification {
  const { op, executorReport, context } = input;
  const executable = fsChangeToExecutableOp(op);
  const probe =
    context.realityProbe ??
    (typeof context.workspaceRoot === "string" && context.workspaceRoot.trim().length > 0
      ? makeFsRealityProbe(context.workspaceRoot)
      : undefined);
  const observerAvailable = probe !== undefined && executable !== null;

  let observation: OutcomeVerification["observation"] = "not_observed";
  let probeDetail: string | undefined;
  let probeError = false;
  let probeVerdict: "agree" | "disagree" | "unknown" | undefined;

  if (observerAvailable && probe !== undefined && executable !== null) {
    const ran = runIndependentProbe(
      probe,
      // Probe the approved intended post-state, not the executor's success flag.
      executionPayloadForApprovedOp(executable, true),
    );
    probeError = ran.error;
    probeVerdict = ran.verdict;
    probeDetail = ran.detail;
    observation = ran.error ? "unknown" : ran.verdict;
  }

  const reconciled = reconcileOutcome({
    executorReport,
    observerAvailable,
    ...(probeVerdict !== undefined ? { probeVerdict } : {}),
    ...(probeError ? { probeError: true } : {}),
    ...(probeDetail !== undefined ? { probeDetail } : {}),
  });

  const x = createExecutorReportEnvelope({
    kind: executorReport,
    operationType: op.operationType,
    targetPath: fsChangeTargetPath(op),
    workflowRunId: context.workflowRunId,
    stepIndex: context.stepIndex,
    ...(input.executorDetail !== undefined ? { detail: input.executorDetail } : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
  });
  const o = createOutcomeObservationEnvelope({
    observation,
    observer: observerAvailable ? "fs_reality_probe" : "none",
    approvedPath: fsChangeTargetPath(op),
    workflowRunId: context.workflowRunId,
    stepIndex: context.stepIndex,
    ...(probeDetail !== undefined ? { detail: probeDetail } : {}),
  });
  const r = createOutcomeReconciliationEnvelope({
    executorReportId: x.id,
    observationId: o.id,
    executorReport,
    observation,
    status: reconciled.status,
    workflowRunId: context.workflowRunId,
    stepIndex: context.stepIndex,
    ...(reconciled.realityVerdict !== undefined
      ? { realityVerdict: reconciled.realityVerdict }
      : {}),
    ...(reconciled.intendedVsActual !== undefined
      ? { intendedVsActual: reconciled.intendedVsActual }
      : {}),
  });

  persistEnvelope(context.storeDir, x);
  persistEnvelope(context.storeDir, o);
  persistEnvelope(context.storeDir, r);

  return {
    ...reconciled,
    executorReportId: x.id,
    observationId: o.id,
    reconciliationId: r.id,
  };
}

export function unverifiedFromAccepted(): OutcomeVerification {
  return reconcileOutcome({
    executorReport: "accepted",
    observerAvailable: false,
  });
}
