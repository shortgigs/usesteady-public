/**
 * GET /api/executor/observability/trust/correlation/:job_id — correlated trust (read-only).
 * @see docs/product/executor-correlated-trust-surface-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  buildCorrelatedTrustSurfaceView,
  ObservabilityRejectedError,
} from "../observability/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import {
  getExecutionEvidence,
  listExecutionEvidenceBundles,
} from "./execution-evidence-store.js";

export const OBSERVABILITY_CORRELATED_TRUST_ROUTE =
  "/api/executor/observability/trust/correlation/:job_id";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function handleCorrelatedTrust(req: Request, res: Response): void {
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
    const correlation_trust = buildCorrelatedTrustSurfaceView({
      worker_result:    evidence.worker_result,
      evidence_bundles: listExecutionEvidenceBundles(),
    });
    res.status(200).json({ ok: true, correlation_trust });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(
        failureEnvelope("correlation_trust_projection_rejected", err.explain),
      );
      return;
    }
    res.status(500).json(
      failureEnvelope(
        "internal_error",
        "Correlated trust surface projection failed closed.",
      ),
    );
  }
}

export function registerExecutorCorrelatedTrustRoute(app: Express): void {
  app.get(OBSERVABILITY_CORRELATED_TRUST_ROUTE, handleCorrelatedTrust);
}
