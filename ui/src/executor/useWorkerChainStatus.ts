/**
 * Sole UI worker chain API paths — intake + descriptive status only (INV-UICHAIN-*).
 * @see docs/product/executor-ui-worker-chain-integration-contract-v1.md
 */

import { useCallback, useState } from "react";
import type {
  ApplyFixPreviewRequest,
  ExecutorRouteErrorEnvelope,
  MutationAuthorizationRequest,
  UiChainIntakeRequestBody,
  UiChainIntakeSuccessBody,
  WorkerChainStatusProjection,
  WorkerChainStatusSuccessBody,
} from "./types.js";

export const UI_CHAIN_INTAKE_PATH = "/api/executor/ui-chain/intake";
export const UI_CHAIN_STATUS_PATH_PREFIX = "/api/executor/ui-chain/status";

export type WorkerChainState =
  | { readonly status: "idle" }
  | { readonly status: "intake_loading" }
  | {
      readonly status: "intake_error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "intake_accepted";
      readonly result: UiChainIntakeSuccessBody;
    }
  | { readonly status: "status_loading" }
  | {
      readonly status: "status_error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "status_ready";
      readonly projection: WorkerChainStatusProjection;
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

export function workerChainStatusUrl(job_id: string): string {
  return `${UI_CHAIN_STATUS_PATH_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useWorkerChainStatus() {
  const [state, setState] = useState<WorkerChainState>({ status: "idle" });

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const submitIntake = useCallback(
    async (input: {
      readonly authorization_request: MutationAuthorizationRequest;
      readonly pipeline: ApplyFixPreviewRequest;
      readonly operator_mint_confirmed: boolean;
    }) => {
      if (!input.operator_mint_confirmed) {
        setState({
          status:     "intake_error",
          httpStatus: 400,
          envelope: {
            error:           true,
            rejection_cause: "operator_confirmation_required",
            explain:
              "Operator mint confirmation is required before server intake.",
          },
        });
        return;
      }

      const body: UiChainIntakeRequestBody = {
        authorization_request:      input.authorization_request,
        operator_mint_confirmation: true,
        pipeline:                   input.pipeline,
      };

      setState({ status: "intake_loading" });
      try {
        const res = await fetch(UI_CHAIN_INTAKE_PATH, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
        const parsed: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          if (isErrorEnvelope(parsed)) {
            setState({
              status: "intake_error",
              envelope: parsed,
              httpStatus: res.status,
            });
            return;
          }
          setState({
            status:     "intake_error",
            httpStatus: res.status,
            envelope: {
              error:           true,
              rejection_cause: "request_failed",
              explain:         `UI chain intake failed (${res.status}).`,
            },
          });
          return;
        }
        const result = parsed as UiChainIntakeSuccessBody;
        setState({ status: "intake_accepted", result });
      } catch {
        setState({
          status:     "intake_error",
          httpStatus: 0,
          envelope: {
            error:           true,
            rejection_cause: "network_error",
            explain:
              "Could not reach the UI chain intake API. Check that the API server is running.",
          },
        });
      }
    },
    [],
  );

  const refreshStatus = useCallback(async (job_id: string) => {
    setState({ status: "status_loading" });
    try {
      const res = await fetch(workerChainStatusUrl(job_id));
      const parsed: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (isErrorEnvelope(parsed)) {
          setState({
            status: "status_error",
            envelope: parsed,
            httpStatus: res.status,
          });
          return;
        }
        setState({
          status:     "status_error",
          httpStatus: res.status,
          envelope: {
            error:           true,
            rejection_cause: "request_failed",
            explain:         `Worker chain status failed (${res.status}).`,
          },
        });
        return;
      }
      const body = parsed as WorkerChainStatusSuccessBody;
      setState({ status: "status_ready", projection: body.projection });
    } catch {
      setState({
        status:     "status_error",
        httpStatus: 0,
        envelope: {
          error:           true,
          rejection_cause: "network_error",
          explain:
            "Could not reach the worker chain status API. Check that the API server is running.",
        },
      });
    }
  }, []);

  return { state, reset, submitIntake, refreshStatus };
}
