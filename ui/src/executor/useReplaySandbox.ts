/**
 * Sole replay-sandbox observability path (read-only).
 * @see docs/product/executor-replay-execution-sandbox-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";

import type {
  ExecutorRouteErrorEnvelope,
  ObservabilityReplaySandboxSuccessBody,
  ReplaySandboxBundle,
} from "./types.js";

export const OBSERVABILITY_REPLAY_SANDBOX_ROUTE_PREFIX =
  "/api/executor/observability/replay-sandbox";

export type ReplaySandboxState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly replay_sandbox: ReplaySandboxBundle;
    }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
    };

function sandboxUrl(job_id: string): string {
  return `${OBSERVABILITY_REPLAY_SANDBOX_ROUTE_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useReplaySandbox(job_id: string | undefined) {
  const [state, setState] = useState<ReplaySandboxState>({ status: "idle" });

  const reload = useCallback(async () => {
    const id = job_id?.trim();
    if (id === undefined || id.length === 0) {
      setState({
        status:  "error",
        envelope: {
          error:            true,
          rejection_cause:  "request_incomplete",
          explain:          "job_id is required for replay sandbox.",
        },
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(sandboxUrl(id));
      const body = (await res.json()) as
        | ObservabilityReplaySandboxSuccessBody
        | ExecutorRouteErrorEnvelope;

      if (!res.ok || "error" in body) {
        const envelope =
          "error" in body
            ? body
            : {
                error:           true as const,
                rejection_cause: "replay_sandbox_load_failed",
                explain:         "Replay sandbox request failed.",
              };
        setState({ status: "error", envelope });
        return;
      }

      const success = body as ObservabilityReplaySandboxSuccessBody;
      if (success.ok !== true || success.replay_sandbox === undefined) {
        setState({
          status:  "error",
          envelope: {
            error:           true,
            rejection_cause: "invalid_response",
            explain:         "Replay sandbox response shape invalid.",
          },
        });
        return;
      }

      setState({ status: "ready", replay_sandbox: success.replay_sandbox });
    } catch {
      setState({
        status:  "error",
        envelope: {
          error:           true,
          rejection_cause: "network_error",
          explain:
            "Could not reach replay sandbox API. Check that the API server is running.",
        },
      });
    }
  }, [job_id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload };
}
