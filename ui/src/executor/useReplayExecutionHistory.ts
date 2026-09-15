/**
 * Sole replay-execution-history observability path (read-only).
 * @see docs/product/prex-execution-history-audit-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";

import type {
  ExecutorRouteErrorEnvelope,
  ObservabilityReplayExecutionHistorySuccessBody,
  ReplayExecutionAuditEntry,
} from "./types.js";

export const OBSERVABILITY_REPLAY_EXECUTION_HISTORY_PATH_PREFIX =
  "/api/executor/observability/replay-execution-history";

export type ReplayExecutionHistoryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
    }
  | {
      readonly status: "ready";
      readonly entries: readonly ReplayExecutionAuditEntry[];
    };

function historyUrl(job_id: string): string {
  return `${OBSERVABILITY_REPLAY_EXECUTION_HISTORY_PATH_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useReplayExecutionHistory(job_id: string | undefined) {
  const [state, setState] = useState<ReplayExecutionHistoryState>({ status: "idle" });

  const reload = useCallback(async () => {
    const id = job_id?.trim();
    if (id === undefined || id.length === 0) {
      setState({
        status:  "error",
        envelope: {
          error:           true,
          rejection_cause: "request_incomplete",
          explain:         "job_id is required for replay execution history.",
        },
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(historyUrl(id));
      const body = (await res.json()) as
        | ObservabilityReplayExecutionHistorySuccessBody
        | ExecutorRouteErrorEnvelope;

      if (!res.ok || "error" in body) {
        const envelope =
          "error" in body
            ? body
            : {
                error:           true as const,
                rejection_cause: "replay_execution_history_failed",
                explain:         "Replay execution history request failed.",
              };
        setState({ status: "error", envelope });
        return;
      }

      const success = body as ObservabilityReplayExecutionHistorySuccessBody;
      if (success.ok !== true || success.entries === undefined) {
        setState({
          status:  "error",
          envelope: {
            error:           true,
            rejection_cause: "invalid_response",
            explain:         "Replay execution history response shape invalid.",
          },
        });
        return;
      }

      setState({ status: "ready", entries: success.entries });
    } catch {
      setState({
        status:  "error",
        envelope: {
          error:           true,
          rejection_cause: "network_error",
          explain:
            "Could not reach replay execution history API. Check that the API server is running.",
        },
      });
    }
  }, [job_id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}
