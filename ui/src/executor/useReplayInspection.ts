/**
 * Sole replay-inspect observability path (read-only).
 * @see docs/product/executor-replay-inspect-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ExecutorRouteErrorEnvelope,
  ObservabilityInspectSuccessBody,
  ReplayInspectionBundle,
} from "./types.js";

export const OBSERVABILITY_INSPECT_PATH_PREFIX =
  "/api/executor/observability/inspect";

export type ReplayInspectionState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly inspect: ReplayInspectionBundle;
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

function inspectUrl(job_id: string): string {
  return `${OBSERVABILITY_INSPECT_PATH_PREFIX}/${encodeURIComponent(job_id)}`;
}

export function useReplayInspection(job_id: string | undefined) {
  const [state, setState] = useState<ReplayInspectionState>({ status: "idle" });

  const load = useCallback(async () => {
    const id = job_id?.trim() ?? "";
    if (id.length === 0) {
      setState({
        status:       "error",
        httpStatus:   400,
        envelope: {
          error:            true,
          rejection_cause:  "request_incomplete",
          explain:          "job_id is required for replay inspection.",
        },
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(inspectUrl(id));
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
            explain:          "Replay inspection request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityInspectSuccessBody;
      if (success.ok !== true || success.inspect === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Replay inspection response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", inspect: success.inspect });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach replay inspection API. Check that the API server is running.",
        },
      });
    }
  }, [job_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
