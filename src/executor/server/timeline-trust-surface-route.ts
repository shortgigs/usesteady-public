/**
 * GET /api/executor/observability/timeline/:job_id/trust — timeline trust surface (read-only).
 * @see docs/product/executor-execution-timeline-trust-surface-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  buildTimelineTrustSurfaceView,
  ObservabilityRejectedError,
} from "../observability/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { getExecutionEvidence } from "./execution-evidence-store.js";

export const OBSERVABILITY_TIMELINE_TRUST_ROUTE =
  "/api/executor/observability/timeline/:job_id/trust";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function handleTimelineTrust(req: Request, res: Response): void {
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
    const timeline_trust = buildTimelineTrustSurfaceView({
      worker_result: evidence.worker_result,
    });
    res.status(200).json({ ok: true, timeline_trust });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(
        failureEnvelope("timeline_trust_projection_rejected", err.explain),
      );
      return;
    }
    res.status(500).json(
      failureEnvelope(
        "internal_error",
        "Timeline trust surface projection failed closed.",
      ),
    );
  }
}

export function registerExecutorTimelineTrustSurfaceRoute(app: Express): void {
  app.get(OBSERVABILITY_TIMELINE_TRUST_ROUTE, handleTimelineTrust);
}
