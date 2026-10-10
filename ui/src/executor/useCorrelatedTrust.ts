/**
 * Sole correlated-trust observability path (read-only).
 * @see docs/product/executor-correlated-trust-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  CorrelatedTrustSurfaceView,
  ExecutorRouteErrorEnvelope,
  ObservabilityCorrelatedTrustSuccessBody,
} from "./types.js";

export const OBSERVABILITY_CORRELATED_TRUST_PATH_PREFIX =
  "/api/executor/observability/trust/correlation";

export type CorrelatedTrustState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly correlation_trust: CorrelatedTrustSurfaceView;
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

function correlatedTrustUrl(job_id: string): string {
  return `${OBSERVABILITY_CORRELATED_TRUST_PATH_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useCorrelatedTrust(job_id: string | undefined) {
  const [state, setState] = useState<CorrelatedTrustState>({ status: "idle" });

  const load = useCallback(async () => {
    const id = job_id?.trim() ?? "";
    if (id.length === 0) {
      setState({
        status:       "error",
        httpStatus:   400,
        envelope: {
          error:            true,
          rejection_cause:  "request_incomplete",
          explain:          "job_id is required for correlated trust surface.",
        },
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(correlatedTrustUrl(id));
      const body: unknown = await res.json();
      if (!res.ok) {
        if (isErrorEnvelope(body)) {
          setState({ status: "error", envelope: body, httpStatus: res.status });
          return;
        }
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "unknown_error",
            explain:          "Correlated trust surface request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityCorrelatedTrustSuccessBody;
      if (success.ok !== true || success.correlation_trust === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Correlated trust surface response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", correlation_trust: success.correlation_trust });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach correlated trust API. Check that the API server is running.",
        },
      });
    }
  }, [job_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
