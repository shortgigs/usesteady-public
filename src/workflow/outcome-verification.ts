/**
 * P6 V1 — split executor self-report from independent outcome verification.
 *
 * Executor `accepted` is a delivery/execution report. It is never, by itself,
 * a verified-against-reality verdict. Only an independent observer
 * (`makeFsRealityProbe` on supported FS ops) may produce `agree`.
 *
 * Vocabulary is existing: RealityVerdict + pulse status. Do not invent names.
 */

import type { FsChange } from "../understand/interpretation/types.js";
import type {
  ExecutableOperation,
  ExecutionPayload,
  RealityVerdict,
} from "../governed-decision/types.js";
import type { RealityProbe, RealityProbeResult } from "../governed-decision/stages/observation.js";

export type ExecutorReportKind = "accepted" | "failed";

/** Pulse / Portal status. Existing W2 literals. */
export type OutcomeVerificationStatus =
  | "verified"
  | "disagreement"
  | "unknown"
  | "unverified";

export type OutcomeObservationKind = RealityVerdict | "not_observed";

export type OutcomeVerification = {
  readonly executorReport: ExecutorReportKind;
  readonly status: OutcomeVerificationStatus;
  /** Raw independent observation. Distinct from `status` (reconciliation). */
  readonly observation: OutcomeObservationKind;
  /**
   * Verdict the trust-surface pulse may count. Omitted when the observation
   * must not become verified-against-reality (no observer, or executor failed).
   */
  readonly realityVerdict?: RealityVerdict;
  readonly intendedVsActual?: "match" | "deviation" | "unknown";
  readonly observationDetail?: string;
  readonly executorReportId?: string;
  readonly observationId?: string;
  readonly reconciliationId?: string;
};

export type ReconcileOutcomeInput = {
  readonly executorReport: ExecutorReportKind;
  readonly observerAvailable: boolean;
  readonly probeVerdict?: RealityVerdict;
  readonly probeError?: boolean;
  readonly probeDetail?: string;
};

/**
 * Reconcile X (executor report) with O (independent observation) into R.
 * Never rewrites X. Never promotes accepted alone. Never promotes failed+match
 * to a pulse `agree`.
 */
export function reconcileOutcome(input: ReconcileOutcomeInput): OutcomeVerification {
  const { executorReport } = input;

  if (!input.observerAvailable) {
    return {
      executorReport,
      status: "unverified",
      observation: "not_observed",
    };
  }

  if (input.probeError) {
    return {
      executorReport,
      status: "unknown",
      observation: "unknown",
      realityVerdict: "unknown",
      intendedVsActual: "unknown",
      ...(input.probeDetail !== undefined ? { observationDetail: input.probeDetail } : {}),
    };
  }

  const probeVerdict = input.probeVerdict;
  if (probeVerdict === undefined) {
    return {
      executorReport,
      status: "unverified",
      observation: "not_observed",
    };
  }

  const intendedVsActual: "match" | "deviation" | "unknown" =
    probeVerdict === "agree" ? "match" : probeVerdict === "disagree" ? "deviation" : "unknown";

  const base = {
    executorReport,
    observation: probeVerdict,
    intendedVsActual,
    ...(input.probeDetail !== undefined ? { observationDetail: input.probeDetail } : {}),
  } as const;

  if (executorReport === "failed") {
    // Preserve both facts. Do not rewrite the executor report into success,
    // and do not emit pulse `agree` from a failed delivery.
    return {
      ...base,
      status: "unverified",
    };
  }

  if (probeVerdict === "agree") {
    return { ...base, status: "verified", realityVerdict: "agree" };
  }
  if (probeVerdict === "disagree") {
    return { ...base, status: "disagreement", realityVerdict: "disagree" };
  }
  return { ...base, status: "unknown", realityVerdict: "unknown" };
}

export function fsChangeTargetPath(op: FsChange): string {
  switch (op.operationType) {
    case "create_dir":
      return op.dirPath;
    case "write_file":
    case "append_file":
    case "prepend_file":
    case "delete_file":
      return op.filePath;
    case "rename":
      return op.filePath;
    case "run_command":
      return op.command;
  }
}

/**
 * Map a workflow FS op onto the existing probe's ExecutableOperation.
 * Unsupported / opaque kinds return null — observer not available (honest).
 */
export function fsChangeToExecutableOp(op: FsChange): ExecutableOperation | null {
  switch (op.operationType) {
    case "create_dir":
      return { kind: "create_dir", path: op.dirPath };
    case "write_file":
      return {
        kind: "create_file",
        path: op.filePath,
        content: op.approvedContent?.utf8 ?? op.content,
      };
    case "delete_file":
      return {
        kind: "delete_file",
        path: op.filePath,
        // Probe verifies absence only; the pin is required by the union.
        expectedPriorSha256: "0".repeat(64),
      };
    case "append_file":
    case "prepend_file":
    case "rename":
    case "run_command":
      return null;
  }
}

export function executionPayloadForApprovedOp(
  op: ExecutableOperation,
  claimedRan: boolean,
): ExecutionPayload {
  return {
    ranWhatWasApproved: claimedRan,
    deterministic: true,
    steps: [op.kind],
    results: [
      {
        op,
        status: claimedRan ? "ran" : "failed",
        detail: claimedRan ? "executor reported accepted" : "executor reported failed",
      },
    ],
  };
}

export function runIndependentProbe(
  probe: RealityProbe,
  payload: ExecutionPayload,
): { verdict: RealityVerdict; detail?: string; error: boolean } {
  try {
    const result = probe(payload);
    if (result instanceof Promise) {
      throw new Error("async probe is not in the P6 V1 FS path");
    }
    return resultToTuple(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { verdict: "unknown", detail: message, error: true };
  }
}

function resultToTuple(result: RealityProbeResult): {
  verdict: RealityVerdict;
  detail?: string;
  error: boolean;
} {
  return {
    verdict: result.realityVerdict,
    ...(result.detail !== undefined ? { detail: result.detail } : {}),
    error: false,
  };
}

/** R applies to X and O only when the bound ids still match. */
export function reconciliationBinds(input: {
  readonly reconciliationExecutorReportId: string;
  readonly reconciliationObservationId: string;
  readonly executorReportId: string;
  readonly observationId: string;
}): boolean {
  return (
    input.reconciliationExecutorReportId === input.executorReportId &&
    input.reconciliationObservationId === input.observationId
  );
}
