/**
 * POST /api/executor/replay-execution/:job_id — record-only PREX execution.
 * @see docs/product/prex-route-implementation-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  deriveExecutionRecordSnapshot,
  reconstructReplaySandbox,
} from "../../replay-sandbox/reconstruct.js";
import {
  evaluateReplayExecutionEligibility,
} from "../../replay-execution/eligibility/evaluate.js";
import {
  executeReplaySandboxCandidate,
} from "../../replay-execution/execute.js";
import {
  appendReplayExecutionAuditEntry,
  deriveReplayExecutionAuditEntry,
} from "../../replay-execution/audit/index.js";
import { ReplayExecutionAuditRejectedError } from "../../replay-execution/audit/types.js";
import { ReplayExecutionRejectedError } from "../../replay-execution/types.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { getExecutionEvidence } from "./execution-evidence-store.js";

export const EXECUTOR_REPLAY_EXECUTION_ROUTE_PREFIX =
  "/api/executor/replay-execution";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function parseOperatorConfirmation(body: unknown): true | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const oc = (body as Record<string, unknown>)["operator_confirmation"];
  return oc === true ? true : undefined;
}

function handleReplayExecution(req: Request, res: Response): void {
  const job_id = jobIdFromRequest(req);
  if (job_id.length === 0) {
    res.status(400).json(
      failureEnvelope("request_incomplete", "job_id path parameter is required."),
    );
    return;
  }

  const operator_confirmation = parseOperatorConfirmation(req.body);
  if (operator_confirmation !== true) {
    res.status(422).json(
      failureEnvelope(
        "operator_confirmation_required",
        "Replay execution requires operator_confirmation: true in the request body.",
      ),
    );
    return;
  }

  const evidence = getExecutionEvidence(job_id);
  if (evidence === undefined) {
    res.status(404).json(
      failureEnvelope(
        "evidence_unknown",
        `No execution evidence for job_id ${job_id}. Run UI chain intake first.`,
      ),
    );
    return;
  }

  try {
    const execution = deriveExecutionRecordSnapshot(evidence.worker_result);
    if (execution === undefined) {
      res.status(422).json(
        failureEnvelope(
          "replay_record_incomplete",
          "Execution snapshot could not be derived from worker evidence.",
        ),
      );
      return;
    }

    const replay_candidate = reconstructReplaySandbox({ execution });
    const replay_execution_eligibility = evaluateReplayExecutionEligibility({
      replay_sandbox_candidate: replay_candidate,
    });

    const replay_execution = executeReplaySandboxCandidate({
      replay_candidate,
      replay_execution_eligibility,
      operator_confirmation: true,
    });

    const audit_entry = deriveReplayExecutionAuditEntry({
      job_id,
      worker_result: evidence.worker_result,
      replay_execution,
    });
    appendReplayExecutionAuditEntry(audit_entry);

    res.status(200).json({ ok: true, replay_execution });
  } catch (err) {
    if (err instanceof ReplayExecutionAuditRejectedError) {
      res.status(422).json(
        failureEnvelope(err.rejection_cause, err.explain),
      );
      return;
    }
    if (err instanceof ReplayExecutionRejectedError) {
      res.status(422).json(
        failureEnvelope("replay_execution_rejected", err.explain),
      );
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Replay execution failed closed."),
    );
  }
}

export function registerExecutorReplayExecutionRoute(app: Express): void {
  app.post(
    `${EXECUTOR_REPLAY_EXECUTION_ROUTE_PREFIX}/:job_id`,
    handleReplayExecution,
  );
}
