/**
 * GET /api/executor/observability/replay-sandbox/:job_id — isolated replay simulation (read-only).
 * @see docs/product/executor-replay-execution-sandbox-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  buildReplaySandboxBundle,
  ReplaySandboxRejectedError,
} from "../../replay-sandbox/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { getExecutionEvidence } from "./execution-evidence-store.js";

export const OBSERVABILITY_REPLAY_SANDBOX_ROUTE_PREFIX =
  "/api/executor/observability/replay-sandbox";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function handleReplaySandbox(req: Request, res: Response): void {
  const job_id = jobIdFromRequest(req);
  if (job_id.length === 0) {
    res.status(400).json(
      failureEnvelope("request_incomplete", "job_id path parameter is required."),
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
    const replay_sandbox = buildReplaySandboxBundle({
      worker_result: evidence.worker_result,
    });
    res.status(200).json({ ok: true, replay_sandbox });
  } catch (err) {
    if (err instanceof ReplaySandboxRejectedError) {
      res.status(422).json(
        failureEnvelope("replay_sandbox_projection_rejected", err.explain),
      );
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Replay sandbox projection failed closed."),
    );
  }
}

export function registerExecutorReplaySandboxRoute(app: Express): void {
  app.get(`${OBSERVABILITY_REPLAY_SANDBOX_ROUTE_PREFIX}/:job_id`, handleReplaySandbox);
}
