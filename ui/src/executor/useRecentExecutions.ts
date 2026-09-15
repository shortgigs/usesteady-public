/**
 * Sole recent-executions observability path (read-only list).
 * @see docs/product/executor-execution-timeline-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ExecutorRouteErrorEnvelope,
  ObservabilityRecentSuccessBody,
  RecentExecutionsProjection,
} from "./types.js";

export const OBSERVABILITY_RECENT_PATH = "/api/executor/observability/recent";

export type RecentExecutionsState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly recent: RecentExecutionsProjection;
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

export function useRecentExecutions(limit = 50) {
  const [state, setState] = useState<RecentExecutionsState>({ status: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const url = `${OBSERVABILITY_RECENT_PATH}?limit=${encodeURIComponent(String(limit))}`;
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
            explain:          "Recent executions request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityRecentSuccessBody;
      if (success.ok !== true || success.recent === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Recent executions response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", recent: success.recent });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach recent executions API. Check that the API server is running.",
        },
      });
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
