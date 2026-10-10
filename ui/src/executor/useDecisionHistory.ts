/**
 * Sole decision-history observability path (read-only).
 * @see docs/product/executor-execution-decision-history-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  DecisionHistoryProjection,
  ExecutorRouteErrorEnvelope,
  ObservabilityHistorySuccessBody,
} from "./types.js";

export const OBSERVABILITY_HISTORY_PATH_PREFIX =
  "/api/executor/observability/history";

export type DecisionHistoryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly history: DecisionHistoryProjection;
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

function historyUrl(job_id: string): string {
  return `${OBSERVABILITY_HISTORY_PATH_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useDecisionHistory(job_id: string | undefined) {
  const [state, setState] = useState<DecisionHistoryState>({ status: "idle" });

  const load = useCallback(async () => {
    const id = job_id?.trim() ?? "";
    if (id.length === 0) {
      setState({
        status:       "error",
        httpStatus:   400,
        envelope: {
          error:            true,
          rejection_cause:  "request_incomplete",
          explain:          "job_id is required for decision history.",
        },
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(historyUrl(id));
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
            explain:          "Decision history request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityHistorySuccessBody;
      if (success.ok !== true || success.history === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Decision history response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", history: success.history });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach decision history API. Check that the API server is running.",
        },
      });
    }
  }, [job_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
