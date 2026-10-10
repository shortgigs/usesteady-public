/**
 * Execution observability read routes — projections only (INV-OBS-*).
 */

import type { Express, Request, Response } from "express";

import {
  buildExplainabilityRecord,
  buildTimelineProjection,
  buildTraceProjection,
  ObservabilityRejectedError,
} from "../observability/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { getExecutionEvidence } from "./execution-evidence-store.js";

export const OBSERVABILITY_TRACE_ROUTE_PREFIX = "/api/executor/observability/trace";
export const OBSERVABILITY_TIMELINE_ROUTE_PREFIX = "/api/executor/observability/timeline";
export const OBSERVABILITY_EXPLAIN_ROUTE_PREFIX = "/api/executor/observability/explain";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function loadEvidence(job_id: string) {
  if (job_id.length === 0) {
    return {
      ok: false as const,
      status: 400,
      body: failureEnvelope("request_incomplete", "job_id path parameter is required."),
    };
  }
  const evidence = getExecutionEvidence(job_id);
  if (evidence === undefined) {
    return {
      ok: false as const,
      status: 404,
      body: failureEnvelope(
        "evidence_unknown",
        `No execution evidence for job_id ${job_id}. Run UI chain intake first.`,
      ),
    };
  }
  return { ok: true as const, evidence };
}

function handleTrace(req: Request, res: Response): void {
  const loaded = loadEvidence(jobIdFromRequest(req));
  if (!loaded.ok) {
    res.status(loaded.status).json(loaded.body);
    return;
  }
  try {
    const trace = buildTraceProjection({
      worker_result:      loaded.evidence.worker_result,
      descriptive_replay: true,
    });
    res.status(200).json({ ok: true, trace });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(failureEnvelope(err.rejection_cause, err.explain));
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Trace projection failed closed."),
    );
  }
}

function handleTimeline(req: Request, res: Response): void {
  const loaded = loadEvidence(jobIdFromRequest(req));
  if (!loaded.ok) {
    res.status(loaded.status).json(loaded.body);
    return;
  }
  try {
    const trace = buildTraceProjection({
      worker_result: loaded.evidence.worker_result,
    });
    const timeline = buildTimelineProjection({
      trace,
      worker_result: loaded.evidence.worker_result,
    });
    res.status(200).json({ ok: true, timeline });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(failureEnvelope(err.rejection_cause, err.explain));
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Timeline projection failed closed."),
    );
  }
}

function handleExplain(req: Request, res: Response): void {
  const loaded = loadEvidence(jobIdFromRequest(req));
  if (!loaded.ok) {
    res.status(loaded.status).json(loaded.body);
    return;
  }
  try {
    const trace = buildTraceProjection({
      worker_result: loaded.evidence.worker_result,
    });
    const timeline = buildTimelineProjection({
      trace,
      worker_result: loaded.evidence.worker_result,
    });
    const explain = buildExplainabilityRecord({
      trace,
      timeline,
      worker_result:      loaded.evidence.worker_result,
      descriptive_replay: true,
    });
    res.status(200).json({ ok: true, explain });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(failureEnvelope(err.rejection_cause, err.explain));
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Explainability projection failed closed."),
    );
  }
}

export function registerExecutorObservabilityRoutes(app: Express): void {
  app.get(`${OBSERVABILITY_TRACE_ROUTE_PREFIX}/:job_id`, handleTrace);
  app.get(`${OBSERVABILITY_TIMELINE_ROUTE_PREFIX}/:job_id`, handleTimeline);
  app.get(`${OBSERVABILITY_EXPLAIN_ROUTE_PREFIX}/:job_id`, handleExplain);
}
