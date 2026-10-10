/**
 * Bounded HTTP handler — sole pipeline entry is runExecutorPipeline() (INV-SROUTE-6).
 */

import type { Request, Response, Express } from "express";

import { ApplyFixUiRejectedError } from "../ui/types.js";
import { BackgroundJobsRejectedError } from "../jobs/types.js";
import { PersistenceRejectedError } from "../persistence/types.js";
import { ExecutionLedgerRejectedError } from "../ledger/types.js";
import { HandlerIntentRejectedError } from "../handler/types.js";
import { ExecutorRuntimeRejectedError } from "../runtime/types.js";
import { runExecutorPipeline, WireUpPipelineRejectedError } from "../wire-up/index.js";
import { validateExecutorApplyFixRequest } from "./validate-request.js";
import { ExecutorRouteRejectedError } from "./types.js";
import type { ExecutorRouteErrorEnvelope, ExecutorRouteResult } from "./types.js";

const ROUTE_PATH = "/api/executor/apply-fix-preview";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function mapRejectionStatus(rejection_cause: string): number {
  switch (rejection_cause) {
    case "operator_confirmation_required":
    case "executor_record_incomplete":
    case "store_dir_invalid":
    case "capability_handler_id_invalid":
    case "executed_at_invalid":
    case "job_kind_invalid":
    case "ledger_actor_invalid":
      return 400;
    case "executor_not_allowed":
    case "executor_eligibility_expired":
      return 403;
    default:
      return 422;
  }
}

function mapPipelineError(err: unknown): ExecutorRouteResult {
  if (err instanceof ExecutorRouteRejectedError) {
    return {
      ok:     false,
      status: 400,
      body:   failureEnvelope(err.rejection_cause, err.explain),
    };
  }

  if (err instanceof WireUpPipelineRejectedError) {
    return {
      ok:     false,
      status: 400,
      body:   failureEnvelope(err.rejection_cause, err.explain),
    };
  }

  const rejectionTypes = [
    ExecutorRuntimeRejectedError,
    HandlerIntentRejectedError,
    ExecutionLedgerRejectedError,
    PersistenceRejectedError,
    BackgroundJobsRejectedError,
    ApplyFixUiRejectedError,
  ] as const;

  for (const RejectionClass of rejectionTypes) {
    if (err instanceof RejectionClass) {
      const cause = err.rejection_cause;
      return {
        ok:     false,
        status: mapRejectionStatus(cause),
        body:   failureEnvelope(cause, err.explain),
      };
    }
  }

  return {
    ok:     false,
    status: 500,
    body:   failureEnvelope(
      "internal_error",
      "Executor apply-fix preview failed closed.",
    ),
  };
}

/**
 * Run validated transport → pipeline → terminal view (testable without Express).
 */
export function runExecutorApplyFixPreview(body: unknown, now?: Date): ExecutorRouteResult {
  try {
    const input = validateExecutorApplyFixRequest(body, now);
    const view = runExecutorPipeline(input);
    return { ok: true, status: 200, view };
  } catch (err) {
    return mapPipelineError(err);
  }
}

/** POST handler — transport only; no stage calls. */
export function handleExecutorApplyFixPreview(req: Request, res: Response): void {
  const result = runExecutorApplyFixPreview(req.body);
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(200).json(result.view);
}

/** Register bounded executor route on the API bridge (single registration site). */
export function registerExecutorApplyFixRoute(app: Express): void {
  app.post(ROUTE_PATH, handleExecutorApplyFixPreview);
}

export { ROUTE_PATH };
