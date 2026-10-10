/**
 * GET /api/executor/observability/replay-execution-history/:job_id — PREX audit (read-only).
 * @see docs/product/prex-execution-history-audit-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import { listReplayExecutionAuditEntries } from "../../replay-execution/audit/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";

export const OBSERVABILITY_REPLAY_EXECUTION_HISTORY_ROUTE_PREFIX =
  "/api/executor/observability/replay-execution-history";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function handleReplayExecutionHistory(req: Request, res: Response): void {
  const job_id = jobIdFromRequest(req);
  if (job_id.length === 0) {
    res.status(400).json(
      failureEnvelope("request_incomplete", "job_id path parameter is required."),
    );
    return;
  }

  const entries = listReplayExecutionAuditEntries(job_id);
  res.status(200).json({ ok: true, entries });
}

export function registerExecutorReplayExecutionHistoryRoute(app: Express): void {
  app.get(
    `${OBSERVABILITY_REPLAY_EXECUTION_HISTORY_ROUTE_PREFIX}/:job_id`,
    handleReplayExecutionHistory,
  );
}
