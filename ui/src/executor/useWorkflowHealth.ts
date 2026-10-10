/**
 * Sole workflow-health observability path (read-only).
 * @see docs/product/executor-workflow-health-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ExecutorRouteErrorEnvelope,
  ObservabilityHealthSuccessBody,
  WorkflowHealthProjection,
} from "./types.js";

export const OBSERVABILITY_HEALTH_PATH = "/api/executor/observability/health";

export type WorkflowHealthState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly health: WorkflowHealthProjection;
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

export function useWorkflowHealth(window_hours = 24) {
  const [state, setState] = useState<WorkflowHealthState>({ status: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const url = `${OBSERVABILITY_HEALTH_PATH}?window_hours=${encodeURIComponent(String(window_hours))}`;
    try {
      const res = await fetch(url);
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
            explain:          "Workflow health request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityHealthSuccessBody;
      if (success.ok !== true || success.health === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Workflow health response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", health: success.health });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach workflow health API. Check that the API server is running.",
        },
      });
    }
  }, [window_hours]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
