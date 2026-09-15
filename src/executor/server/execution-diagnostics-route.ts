/**
 * GET /api/executor/observability/diagnostics — execution diagnostics (read-only).
 * @see docs/product/executor-execution-diagnostics-surface-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import {
  buildExecutionDiagnosticsBundle,
  MAX_WINDOW_HOURS,
  ObservabilityRejectedError,
} from "../observability/index.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import {
  getExecutionEvidence,
  listExecutionEvidenceBundles,
} from "./execution-evidence-store.js";

export const OBSERVABILITY_EXECUTION_DIAGNOSTICS_ROUTE =
  "/api/executor/observability/diagnostics";

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

function handleExecutionDiagnostics(req: Request, res: Response): void {
  const parsed = parseWindowHours(req.query["window_hours"]);
  if (typeof parsed === "object") {
    res.status(400).json(
      failureEnvelope("request_incomplete", parsed.error),
    );
    return;
  }

  const anchor_job_id = String(req.query["anchor_job_id"] ?? "").trim();
  let anchor_evidence;
  if (anchor_job_id.length > 0) {
    const evidence = getExecutionEvidence(anchor_job_id);
    if (evidence === undefined) {
      res.status(404).json(
        failureEnvelope(
          "evidence_unknown",
          `No execution evidence for anchor_job_id ${anchor_job_id}.`,
        ),
      );
      return;
    }
    anchor_evidence = evidence;
  }

  try {
    const diagnostics = buildExecutionDiagnosticsBundle({
      bundles:          listExecutionEvidenceBundles(),
      ...(anchor_evidence !== undefined ? { anchor_evidence: anchor_evidence } : {}),
      window_hours:     parsed,
    });
    res.status(200).json({ ok: true, diagnostics });
  } catch (err) {
    if (err instanceof ObservabilityRejectedError) {
      res.status(422).json(
        failureEnvelope("execution_diagnostics_projection_rejected", err.explain),
      );
      return;
    }
    res.status(500).json(
      failureEnvelope(
        "internal_error",
        "Execution diagnostics projection failed closed.",
      ),
    );
  }
}

export function registerExecutorExecutionDiagnosticsRoute(app: Express): void {
  app.get(OBSERVABILITY_EXECUTION_DIAGNOSTICS_ROUTE, handleExecutionDiagnostics);
}
