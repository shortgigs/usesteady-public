/**
 * POST replay-execution — explicit operator action only (INV-PREX-UI-IMPL-1..3).
 * @see docs/product/prex-ui-execution-cta-implementation-contract-v1.md
 */

import { useCallback, useState } from "react";

import type {
  ExecutorRouteErrorEnvelope,
  ReplayExecutionRecord,
  ReplayExecutionSuccessBody,
} from "./types.js";

export const REPLAY_EXECUTION_API_PREFIX = "/api/executor/replay-execution";

export type ReplayExecutionHookState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "success";
      readonly replay_execution: ReplayExecutionRecord;
    }
  | {
      readonly status: "error";
      readonly rejection_cause: string;
      readonly explain: string;
    };

function replayExecutionUrl(job_id: string): string {
  return `${REPLAY_EXECUTION_API_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useReplayExecution(job_id: string | undefined): {
  readonly state: ReplayExecutionHookState;
  readonly record: () => Promise<void>;
  readonly reset: () => void;
} {
  const [state, setState] = useState<ReplayExecutionHookState>({ status: "idle" });

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const record = useCallback(async () => {
    const id = job_id?.trim();
    if (id === undefined || id.length === 0) {
      setState({
        status:           "error",
        rejection_cause:  "request_incomplete",
        explain:          "job_id is required for replay execution.",
      });
      return;
    }

    if (state.status === "loading" || state.status === "success") {
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(replayExecutionUrl(id), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ operator_confirmation: true }),
      });
      const body = (await res.json()) as
        | ReplayExecutionSuccessBody
        | ExecutorRouteErrorEnvelope;

      if (!res.ok || "error" in body) {
        const envelope =
          "error" in body
            ? body
            : {
                error:           true as const,
                rejection_cause: "replay_execution_failed",
                explain:         "Replay execution request failed.",
              };
        setState({
          status:          "error",
          rejection_cause: envelope.rejection_cause,
          explain:         envelope.explain,
        });
        return;
      }

      const success = body as ReplayExecutionSuccessBody;
      if (success.ok !== true || success.replay_execution === undefined) {
        setState({
          status:          "error",
          rejection_cause: "invalid_response",
          explain:         "Replay execution response shape invalid.",
        });
        return;
      }

      setState({ status: "success", replay_execution: success.replay_execution });
    } catch {
      setState({
        status:          "error",
        rejection_cause: "network_error",
        explain:
          "Could not reach replay execution API. Check that the API server is running.",
      });
    }
  }, [job_id, state.status]);

  return { state, record, reset };
}
