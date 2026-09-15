/**
 * GET /api/executor/observability/recent — bounded recent execution summaries (read-only).
 * @see docs/product/executor-execution-timeline-surface-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  buildRecentExecutionsProjection,
  DEFAULT_RECENT_EXECUTIONS_LIMIT,
  MAX_RECENT_EXECUTIONS_LIMIT,
} from "../observability/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { listExecutionEvidenceBundles } from "./execution-evidence-store.js";

export const OBSERVABILITY_RECENT_ROUTE = "/api/executor/observability/recent";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function parseLimit(raw: unknown): number | { error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RECENT_EXECUTIONS_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return { error: "limit must be a positive number." };
  }
  if (n > MAX_RECENT_EXECUTIONS_LIMIT) {
    return { error: `limit must not exceed ${MAX_RECENT_EXECUTIONS_LIMIT}.` };
  }
  return Math.floor(n);
}

function handleRecent(req: Request, res: Response): void {
  const parsed = parseLimit(req.query["limit"]);
  if (typeof parsed === "object") {
    res.status(400).json(
      failureEnvelope("request_incomplete", parsed.error),
    );
    return;
  }

  try {
    const bundles = listExecutionEvidenceBundles();
    const recent = buildRecentExecutionsProjection({
      bundles,
      limit: parsed,
    });
    res.status(200).json({ ok: true, recent });
  } catch {
    res.status(500).json(
      failureEnvelope("internal_error", "Recent executions projection failed closed."),
    );
  }
}

export function registerExecutorRecentExecutionsRoute(app: Express): void {
  app.get(OBSERVABILITY_RECENT_ROUTE, handleRecent);
}
