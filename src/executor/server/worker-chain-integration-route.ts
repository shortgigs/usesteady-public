/**
 * UI worker chain integration routes — server orchestration + descriptive status only.
 * @see docs/product/executor-ui-worker-chain-integration-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import { ExecutorRouteRejectedError } from "./types.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import { storeExecutionEvidence } from "./execution-evidence-store.js";
import { orchestrateUiChainIntake } from "./orchestrate-ui-chain-intake.js";
import { resetExecutionEvidenceStoreForTests } from "./execution-evidence-store.js";
import { validateUiChainIntakeBody } from "./validate-worker-chain-request.js";
import type {
  UiChainIntakeSuccessBody,
  WorkerChainStatusProjection,
  WorkerChainStatusSuccessBody,
} from "./worker-chain-types.js";

export const UI_CHAIN_INTAKE_ROUTE = "/api/executor/ui-chain/intake";
export const UI_CHAIN_STATUS_ROUTE_PREFIX = "/api/executor/ui-chain/status";

const intakeReplay = new Map<string, UiChainIntakeSuccessBody>();
const statusByJobId = new Map<string, WorkerChainStatusProjection>();

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function sendFailure(res: Response, err: ExecutorRouteRejectedError): void {
  const status =
    err.rejection_cause === "operator_confirmation_required" ||
    err.rejection_cause === "request_incomplete" ||
    err.rejection_cause === "authorization_not_accepted" ||
    err.rejection_cause === "intent_not_validated" ||
    err.rejection_cause === "intent_key_mismatch"
      ? 400
      : 422;
  res.status(status).json(failureEnvelope(err.rejection_cause, err.explain));
}

function handleUiChainIntake(req: Request, res: Response): void {
  try {
    const body = validateUiChainIntakeBody(req.body);
    const intentKey = body.authorization_request.intent_idempotency_key.trim();
    const prior = intakeReplay.get(intentKey);
    if (prior !== undefined) {
      res.status(200).json({ ...prior, idempotent_replay: true });
      return;
    }

    const now = new Date();
    const out = orchestrateUiChainIntake(body, now);
    const success: UiChainIntakeSuccessBody = {
      ok:         true,
      intake:     out.intake,
      job_id:     out.job.job_id,
      projection: out.projection,
    };
    intakeReplay.set(intentKey, success);
    statusByJobId.set(out.job.job_id, out.projection);
    storeExecutionEvidence(out.job.job_id, {
      worker_result: out.worker_result,
      stored_at:     now.toISOString(),
    });
    res.status(200).json(success);
  } catch (err) {
    if (err instanceof ExecutorRouteRejectedError) {
      sendFailure(res, err);
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "UI chain intake failed closed."),
    );
  }
}

function handleUiChainStatus(req: Request, res: Response): void {
  const job_id = String(req.params["job_id"] ?? "").trim();
  if (job_id.length === 0) {
    res.status(400).json(
      failureEnvelope("request_incomplete", "job_id path parameter is required."),
    );
    return;
  }

  const projection = statusByJobId.get(job_id);
  if (projection === undefined) {
    res.status(404).json(
      failureEnvelope("status_unknown", `No worker chain projection for job_id ${job_id}.`),
    );
    return;
  }

  const body: WorkerChainStatusSuccessBody = {
    ok: true,
    projection: {
      ...projection,
      descriptive_replay: true,
      recorded_at:        new Date().toISOString(),
    },
  };
  res.status(200).json(body);
}

export function registerExecutorWorkerChainIntegrationRoutes(app: Express): void {
  app.post(UI_CHAIN_INTAKE_ROUTE, handleUiChainIntake);
  app.get(`${UI_CHAIN_STATUS_ROUTE_PREFIX}/:job_id`, handleUiChainStatus);
}

/** Test hook — reset in-memory projection store. */
export function resetWorkerChainIntegrationStoresForTests(): void {
  intakeReplay.clear();
  statusByJobId.clear();
  resetExecutionEvidenceStoreForTests();
}

/** Test hook — seed projection without running intake. */
export function seedWorkerChainProjectionForTests(
  projection: WorkerChainStatusProjection,
): void {
  statusByJobId.set(projection.job_id, projection);
}
