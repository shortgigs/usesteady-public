/**
 * GET /api/executor/observability/health — workflow health projection (read-only).
 * @see docs/product/executor-workflow-health-surface-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  buildWorkflowHealthProjection,
  MAX_WINDOW_HOURS,
  ObservabilityRejectedError,
} from "../observability/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { listExecutionEvidenceBundles } from "./execution-evidence-store.js";

export const OBSERVABILITY_HEALTH_ROUTE = "/api/executor/observability/health";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function parseWindowHours(raw: unknown): number | { error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return 24;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return { error: "window_hours must be a positive number." };
  }
  if (n > MAX_WINDOW_HOURS) {
    return { error: `window_hours must not exceed ${MAX_WINDOW_HOURS}.` };
  }
  return Math.floor(n);
}

function handleHealth(req: Request, res: Response): void {
  const parsed = parseWindowHours(req.query["window_hours"]);
  if (typeof parsed === "object") {
    res.status(400).json(
      failureEnvelope("request_incomplete", parsed.error),
    );
    return;
  }

  try {
    const bundles = listExecutionEvidenceBundles();
    const health = buildWorkflowHealthProjection({
      bundles,
      window_hours: parsed,
    });
    res.status(200).json({ ok: true, health });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(failureEnvelope(err.rejection_cause, err.explain));
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Workflow health projection failed closed."),
    );
  }
}

export function registerExecutorWorkflowHealthRoute(app: Express): void {
  app.get(OBSERVABILITY_HEALTH_ROUTE, handleHealth);
}
