/**
 * POST /api/executor/replay-worker-execution/:job_id — descriptive execution only.
 * @see docs/product/replay-worker-execution-implementation-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import { listReplayExecutionAuditEntries } from "../../replay-execution/audit/index.js";
import type { ReplayExecutionAuditEntry } from "../../replay-execution/audit/types.js";
import type { ReplayExecutionRecord } from "../../replay-execution/types.js";
import { dispatchReplayWorker } from "../../replay-workers/dispatch/dispatch.js";
import { evaluateReplayWorkerEligibility } from "../../replay-workers/eligibility/evaluate.js";
import {
  evaluateReplayWorkerExecutionEligibility,
} from "../../replay-workers/execution/evaluate.js";
import { runBoundedReplayWorker } from "../../replay-workers/execution/run.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";

export const EXECUTOR_REPLAY_WORKER_EXECUTION_ROUTE_PREFIX =
  "/api/executor/replay-worker-execution";

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

function replayExecutionFromAudit(
  entry: ReplayExecutionAuditEntry,
): ReplayExecutionRecord {
  const lineageKind =
    entry.replay_execution_state === "executed"
      ? "replay_execution_completed"
      : entry.replay_execution_state === "blocked"
        ? "replay_execution_blocked"
        : "replay_execution_expired";

  return {
    replay_execution_id:        entry.replay_execution_id,
    replay_sandbox_id:          entry.replay_sandbox_id,
    replay_execution_state:     entry.replay_execution_state,
    replay_execution_created_at: entry.recorded_at,
    replay_execution_version:   entry.replay_execution_version,
    replay_execution_lineage: [
      { at: entry.recorded_at, kind: lineageKind },
    ],
    replay_execution_reason: entry.replay_execution_reason,
  };
}

function latestAuditEntry(
  job_id: string,
): ReplayExecutionAuditEntry | undefined {
  const entries = listReplayExecutionAuditEntries(job_id);
  if (entries.length === 0) return undefined;
  return entries[entries.length - 1];
}

function handleReplayWorkerExecution(req: Request, res: Response): void {
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
        "Replay worker execution requires operator_confirmation: true in the request body.",
      ),
    );
    return;
  }

  const audit_entry = latestAuditEntry(job_id);
  if (audit_entry === undefined) {
    res.status(422).json(
      failureEnvelope(
        "replay_record_incomplete",
        "No PREX audit entry for job_id — run replay-execution POST first.",
      ),
    );
    return;
  }

  const replay_execution = replayExecutionFromAudit(audit_entry);
  const replay_worker_eligibility = evaluateReplayWorkerEligibility({
    replay_execution,
  });

  const replay_worker_dispatch = dispatchReplayWorker({
    job_id,
    replay_worker_eligibility,
    operator_confirmation: true,
  });

  const replay_worker_execution_eligibility = evaluateReplayWorkerExecutionEligibility({
    replay_worker_dispatch,
  });

  const execution = runBoundedReplayWorker({
    job_id,
    replay_worker_execution_eligibility,
    operator_confirmation: true,
  });

  res.status(200).json({ ok: true, execution });
}

export function registerExecutorReplayWorkerExecutionRoute(app: Express): void {
  app.post(
    `${EXECUTOR_REPLAY_WORKER_EXECUTION_ROUTE_PREFIX}/:job_id`,
    handleReplayWorkerExecution,
  );
}
