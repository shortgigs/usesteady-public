/**
 * POST /api/executor/replay-worker-side-effect/:job_id — descriptive side effects only.
 * @see docs/product/replay-worker-side-effect-runtime-contract-v1.md
 */

import type { Express, Request, Response } from "express";

import { listReplayExecutionAuditEntries } from "../../replay-execution/audit/index.js";
import type { ReplayExecutionAuditEntry } from "../../replay-execution/audit/types.js";
import type { ReplayExecutionRecord } from "../../replay-execution/types.js";
import { dispatchReplayWorker } from "../../replay-workers/dispatch/dispatch.js";
import { evaluateReplayWorkerEligibility } from "../../replay-workers/eligibility/evaluate.js";
import {
  evaluateReplayWorkerExecutionEligibility,
} from "../../replay-workers/execution/evaluate.js";
import { runBoundedReplayWorker } from "../../replay-workers/execution/run.js";
import {
  isReplayWorkerSideEffectScope,
  type ReplayWorkerSideEffectScope,
} from "../../replay-workers/side-effect/constants.js";
import {
  evaluateReplayWorkerSideEffectEligibility,
} from "../../replay-workers/side-effect/evaluate.js";
import { runBoundedReplayWorkerSideEffect } from "../../replay-workers/side-effect/run.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";

export const EXECUTOR_REPLAY_WORKER_SIDE_EFFECT_ROUTE_PREFIX =
  "/api/executor/replay-worker-side-effect";

function failureEnvelope(
  rejection_cause: string,
  explain: string,
): ExecutorRouteErrorEnvelope {
  return { error: true, rejection_cause, explain };
}

function jobIdFromRequest(req: Request): string {
  return String(req.params["job_id"] ?? "").trim();
}

function parseOperatorConfirmation(body: unknown): true | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const oc = (body as Record<string, unknown>)["operator_confirmation"];
  return oc === true ? true : undefined;
}

function parseSideEffectScope(body: unknown): ReplayWorkerSideEffectScope | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const raw = (body as Record<string, unknown>)["replay_worker_side_effect_scope"];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return isReplayWorkerSideEffectScope(trimmed) ? trimmed : undefined;
}

function replayExecutionFromAudit(
  entry: ReplayExecutionAuditEntry,
): ReplayExecutionRecord {
  const lineageKind =
    entry.replay_execution_state === "executed"
      ? "replay_execution_completed"
      : entry.replay_execution_state === "blocked"
        ? "replay_execution_blocked"
        : "replay_execution_expired";

  return {
    replay_execution_id:        entry.replay_execution_id,
    replay_sandbox_id:          entry.replay_sandbox_id,
    replay_execution_state:     entry.replay_execution_state,
    replay_execution_created_at: entry.recorded_at,
    replay_execution_version:   entry.replay_execution_version,
    replay_execution_lineage: [
      { at: entry.recorded_at, kind: lineageKind },
    ],
    replay_execution_reason: entry.replay_execution_reason,
  };
}

function latestAuditEntry(
  job_id: string,
): ReplayExecutionAuditEntry | undefined {
  const entries = listReplayExecutionAuditEntries(job_id);
  if (entries.length === 0) return undefined;
  return entries[entries.length - 1];
}

function materializeLatestExecution(job_id: string) {
  const audit_entry = latestAuditEntry(job_id);
  if (audit_entry === undefined) return undefined;

  const replay_execution = replayExecutionFromAudit(audit_entry);
  const replay_worker_eligibility = evaluateReplayWorkerEligibility({
    replay_execution,
  });

  const replay_worker_dispatch = dispatchReplayWorker({
    job_id,
    replay_worker_eligibility,
    operator_confirmation: true,
  });

  const replay_worker_execution_eligibility = evaluateReplayWorkerExecutionEligibility({
    replay_worker_dispatch,
  });

  return runBoundedReplayWorker({
    job_id,
    replay_worker_execution_eligibility,
    operator_confirmation: true,
  });
}

function handleReplayWorkerSideEffect(req: Request, res: Response): void {
  const job_id = jobIdFromRequest(req);
  if (job_id.length === 0) {
    res.status(400).json(
      failureEnvelope("request_incomplete", "job_id path parameter is required."),
    );
    return;
  }

  const operator_confirmation = parseOperatorConfirmation(req.body);
  if (operator_confirmation !== true) {
    res.status(422).json(
      failureEnvelope(
        "operator_confirmation_required",
        "Replay worker side effect requires operator_confirmation: true in the request body.",
      ),
    );
    return;
  }

  const replay_worker_side_effect_scope = parseSideEffectScope(req.body);
  if (replay_worker_side_effect_scope === undefined) {
    res.status(422).json(
      failureEnvelope(
        "side_effect_scope_invalid",
        "replay_worker_side_effect_scope must be one of: descriptive_log, descriptive_projection, descriptive_trace.",
      ),
    );
    return;
  }

  const replay_worker_execution = materializeLatestExecution(job_id);
  if (replay_worker_execution === undefined) {
    res.status(422).json(
      failureEnvelope(
        "replay_record_incomplete",
        "No PREX audit entry for job_id — run replay-execution POST first.",
      ),
    );
    return;
  }

  const replay_worker_side_effect_eligibility = evaluateReplayWorkerSideEffectEligibility({
    replay_worker_execution,
  });

  const side_effect = runBoundedReplayWorkerSideEffect({
    replay_worker_side_effect_eligibility,
    operator_confirmation: true,
    replay_worker_side_effect_scope,
  });

  res.status(200).json({ ok: true, side_effect });
}

export function registerExecutorReplayWorkerSideEffectRoute(app: Express): void {
  app.post(
    `${EXECUTOR_REPLAY_WORKER_SIDE_EFFECT_ROUTE_PREFIX}/:job_id`,
    handleReplayWorkerSideEffect,
  );
}
