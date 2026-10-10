/**
 * Sole execution-governance observability path (read-only).
 * @see docs/product/executor-execution-governance-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ExecutorRouteErrorEnvelope,
  GovernanceTrustBundle,
  ObservabilityExecutionGovernanceSuccessBody,
} from "./types.js";

export const OBSERVABILITY_EXECUTION_GOVERNANCE_PATH =
  "/api/executor/observability/governance";

export type ExecutionGovernanceState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly governance: GovernanceTrustBundle;
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

function governanceUrl(window_hours: number, anchor_job_id?: string): string {
  const params = new URLSearchParams();
  params.set("window_hours", String(window_hours));
  const anchor = anchor_job_id?.trim() ?? "";
  if (anchor.length > 0) {
    params.set("anchor_job_id", anchor);
  }
  return `${OBSERVABILITY_EXECUTION_GOVERNANCE_PATH}?${params.toString()}`;
}

export function useExecutionGovernance(
  window_hours = 24,
  anchor_job_id?: string,
) {
  const [state, setState] = useState<ExecutionGovernanceState>({ status: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(governanceUrl(window_hours, anchor_job_id));
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
            explain:          "Execution governance request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityExecutionGovernanceSuccessBody;
      if (success.ok !== true || success.governance === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Execution governance response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", governance: success.governance });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach execution governance API. Check that the API server is running.",
        },
      });
    }
  }, [window_hours, anchor_job_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
