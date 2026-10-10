/**
 * UI mutation authorization routes — validation + request acceptance only (INV-UIMUT-*).
 * Does not mint authority, invoke handlers, execute commands, or apply mutations.
 */

import type { Express, Request, Response } from "express";

import { ExecutorRouteRejectedError } from "./types.js";
import type { ExecutorRouteErrorEnvelope } from "./types.js";
import {
  validateMutationAuthorizationBody,
  validateMutationIntentBody,
} from "./validate-mutation-wiring.js";
import type {
  MutationAuthorizationSuccessBody,
  MutationIntentSuccessBody,
} from "./mutation-wiring-types.js";

export const MUTATION_INTENT_ROUTE = "/api/executor/mutation-intent";
export const MUTATION_AUTHORIZATION_REQUEST_ROUTE =
  "/api/executor/mutation-authorization-request";

const intentReplay = new Map<string, MutationIntentSuccessBody>();
const authorizationReplay = new Map<string, MutationAuthorizationSuccessBody>();

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
    err.rejection_cause === "scope_widening_denied" ||
    err.rejection_cause === "presentation_surface_invalid" ||
    err.rejection_cause === "target_scope_empty" ||
    err.rejection_cause === "intent_key_mismatch"
      ? 400
      : 422;
  res.status(status).json(failureEnvelope(err.rejection_cause, err.explain));
}

function handleMutationIntent(req: Request, res: Response): void {
  try {
    const body = validateMutationIntentBody(req.body);
    const key = body.intent.intent_idempotency_key;
    const prior = intentReplay.get(key);
    if (prior !== undefined) {
      res.status(200).json({ ...prior, idempotent_replay: true });
      return;
    }
    const success: MutationIntentSuccessBody = {
      ok:                    true,
      intent_idempotency_key: key,
      validated_intent:      body.intent,
    };
    intentReplay.set(key, success);
    res.status(200).json(success);
  } catch (err) {
    if (err instanceof ExecutorRouteRejectedError) {
      sendFailure(res, err);
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Mutation intent validation failed."),
    );
  }
}

function handleMutationAuthorizationRequest(req: Request, res: Response): void {
  try {
    const body = validateMutationAuthorizationBody(req.body);
    const key = body.authorization_request.authorization_request_id;
    const prior = authorizationReplay.get(key);
    if (prior !== undefined) {
      res.status(200).json({ ...prior, idempotent_replay: true });
      return;
    }
    const success: MutationAuthorizationSuccessBody = {
      ok:                       true,
      accepted:                 true,
      authorization_request_id: key,
      intent_idempotency_key:   body.authorization_request.intent_idempotency_key,
      note:
        "Authorization request accepted. ExecutionAuthorityRecord mint and worker chain run on operator path only — not from this endpoint.",
    };
    authorizationReplay.set(key, success);
    res.status(200).json(success);
  } catch (err) {
    if (err instanceof ExecutorRouteRejectedError) {
      sendFailure(res, err);
      return;
    }
    res.status(500).json(
      failureEnvelope("internal_error", "Mutation authorization request validation failed."),
    );
  }
}

export function isIntentValidated(intent_idempotency_key: string): boolean {
  return intentReplay.has(intent_idempotency_key.trim());
}

export function isAuthorizationAccepted(authorization_request_id: string): boolean {
  return authorizationReplay.has(authorization_request_id.trim());
}

/** Test hook — seed accepted mutation paths without HTTP. */
export function seedMutationWiringReplayForTests(input: {
  readonly intent: MutationIntentSuccessBody;
  readonly authorization: MutationAuthorizationSuccessBody;
}): void {
  intentReplay.set(input.intent.intent_idempotency_key, input.intent);
  authorizationReplay.set(
    input.authorization.authorization_request_id,
    input.authorization,
  );
}

export function registerExecutorMutationWiringRoutes(app: Express): void {
  app.post(MUTATION_INTENT_ROUTE, handleMutationIntent);
  app.post(MUTATION_AUTHORIZATION_REQUEST_ROUTE, handleMutationAuthorizationRequest);
}
