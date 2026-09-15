/**
 * Sole mutation authorization API paths (request only — no runtime invoke).
 * @see docs/product/executor-ui-mutation-authorization-contract-v1.md
 */

import { useCallback, useState } from "react";
import type {
  ApplyFixViewModel,
  ExecutorRouteErrorEnvelope,
  MutationAuthorizationRequest,
  MutationAuthorizationRequestBody,
  MutationAuthorizationSuccessBody,
  MutationIntentRequest,
  MutationIntentRequestBody,
  MutationIntentSuccessBody,
} from "./types.js";

export const MUTATION_INTENT_PATH = "/api/executor/mutation-intent";
export const MUTATION_AUTHORIZATION_REQUEST_PATH =
  "/api/executor/mutation-authorization-request";

export type MutationAuthorizationState =
  | { readonly status: "idle" }
  | { readonly status: "intent_loading" }
  | {
      readonly status: "intent_error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "intent_validated";
      readonly result: MutationIntentSuccessBody;
    }
  | { readonly status: "authorization_loading" }
  | {
      readonly status: "authorization_error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "authorization_accepted";
      readonly result: MutationAuthorizationSuccessBody;
      readonly authorization_request: MutationAuthorizationRequest;
    };

function isErrorEnvelope(value: unknown): value is ExecutorRouteErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o["error"] === true &&
    typeof o["rejection_cause"] === "string" &&
    typeof o["explain"] === "string"
  );
}

function buildIntentFromView(view: ApplyFixViewModel): MutationIntentRequest {
  return {
    intent_idempotency_key: `${view.job_id}:${view.idempotency_key}:mut-intent`,
    job_id:                 view.job_id,
    capability_id:          view.capability_id,
    target_scope:           view.target_scope,
    mutation_summary:       view.intent_summary,
    lineage_ref:            view.lineage_rows.map(
      (r) => `${r.source}:${r.kind}:${r.execution_id}`,
    ),
    requested_at:           new Date().toISOString(),
    presentation_surface:   "react_apply_fix",
  };
}

function buildIntentBody(view: ApplyFixViewModel): MutationIntentRequestBody {
  return {
    intent: buildIntentFromView(view),
    allowed_envelope: {
      capability_id:     view.capability_id,
      handler_intent_id: view.handler_intent_id,
      target_scope:      view.target_scope,
      job_kind:            view.job_kind,
    },
  };
}

export function useMutationAuthorization() {
  const [state, setState] = useState<MutationAuthorizationState>({
    status: "idle",
  });

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const submitIntent = useCallback(async (view: ApplyFixViewModel) => {
    const body = buildIntentBody(view);
    setState({ status: "intent_loading" });
    try {
      const res = await fetch(MUTATION_INTENT_PATH, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const parsed: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (isErrorEnvelope(parsed)) {
          setState({
            status: "intent_error",
            envelope: parsed,
            httpStatus: res.status,
          });
          return;
        }
        setState({
          status:     "intent_error",
          httpStatus: res.status,
          envelope: {
            error:           true,
            rejection_cause: "request_failed",
            explain:         `Mutation intent request failed (${res.status}).`,
          },
        });
        return;
      }
      setState({
        status: "intent_validated",
        result: parsed as MutationIntentSuccessBody,
      });
    } catch {
      setState({
        status:     "intent_error",
        httpStatus: 0,
        envelope: {
          error:           true,
          rejection_cause: "network_error",
          explain:
            "Could not reach the mutation intent API. Check that the API server is running.",
        },
      });
    }
  }, []);

  const submitAuthorizationRequest = useCallback(
    async (input: {
      readonly view: ApplyFixViewModel;
      readonly validated_intent: MutationIntentRequest;
      readonly operator_confirmed: boolean;
    }) => {
      if (!input.operator_confirmed) {
        setState({
          status:     "authorization_error",
          httpStatus: 400,
          envelope: {
            error:           true,
            rejection_cause: "operator_confirmation_required",
            explain:
              "Operator confirmation is required before submitting an authorization request.",
          },
        });
        return;
      }

      const authorization_request_id = `${input.validated_intent.intent_idempotency_key}:auth:${Date.now()}`;
      const body: MutationAuthorizationRequestBody = {
        authorization_request: {
          authorization_request_id,
          intent_idempotency_key: input.validated_intent.intent_idempotency_key,
          validated_intent:       input.validated_intent,
          actor_id:                 input.view.actor_id,
          operator_confirmation:    true,
          confirmation_at:          new Date().toISOString(),
          scope_envelope: {
            capability_id:     input.view.capability_id,
            handler_intent_id: input.view.handler_intent_id,
            target_scope:      input.view.target_scope,
            job_kind:            input.view.job_kind,
          },
          lineage_ref: input.validated_intent.lineage_ref,
        },
      };

      setState({ status: "authorization_loading" });
      try {
        const res = await fetch(MUTATION_AUTHORIZATION_REQUEST_PATH, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
        const parsed: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          if (isErrorEnvelope(parsed)) {
            setState({
              status: "authorization_error",
              envelope: parsed,
              httpStatus: res.status,
            });
            return;
          }
          setState({
            status:     "authorization_error",
            httpStatus: res.status,
            envelope: {
              error:           true,
              rejection_cause: "request_failed",
              explain:         `Authorization request failed (${res.status}).`,
            },
          });
          return;
        }
        setState({
          status:               "authorization_accepted",
          result:               parsed as MutationAuthorizationSuccessBody,
          authorization_request: body.authorization_request,
        });
      } catch {
        setState({
          status:     "authorization_error",
          httpStatus: 0,
          envelope: {
            error:           true,
            rejection_cause: "network_error",
            explain:
              "Could not reach the mutation authorization API. Check that the API server is running.",
          },
        });
      }
    },
    [],
  );

  return { state, reset, submitIntent, submitAuthorizationRequest, buildIntentBody };
}
