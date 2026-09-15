/**
 * Sole timeline-trust observability path (read-only).
 * @see docs/product/executor-execution-timeline-trust-surface-contract-v1.md
 */

import { useCallback, useEffect, useState } from "react";
import type {
  ExecutorRouteErrorEnvelope,
  ObservabilityTimelineTrustSuccessBody,
  TimelineTrustSurfaceView,
} from "./types.js";

export const OBSERVABILITY_TIMELINE_TRUST_PATH_PREFIX =
  "/api/executor/observability/timeline";

export type TimelineTrustSurfaceState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly timeline_trust: TimelineTrustSurfaceView;
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

function timelineTrustUrl(job_id: string): string {
  return `${OBSERVABILITY_TIMELINE_TRUST_PATH_PREFIX}/${encodeURIComponent(job_id)}/trust`;
}

export function useTimelineTrustSurface(job_id: string | undefined) {
  const [state, setState] = useState<TimelineTrustSurfaceState>({ status: "idle" });

  const load = useCallback(async () => {
    const id = job_id?.trim() ?? "";
    if (id.length === 0) {
      setState({
        status:       "error",
        httpStatus:   400,
        envelope: {
          error:            true,
          rejection_cause:  "request_incomplete",
          explain:          "job_id is required for timeline trust surface.",
        },
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(timelineTrustUrl(id));
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
            explain:          "Timeline trust surface request failed.",
          },
        });
        return;
      }
      const success = body as ObservabilityTimelineTrustSuccessBody;
      if (success.ok !== true || success.timeline_trust === undefined) {
        setState({
          status:       "error",
          httpStatus:   res.status,
          envelope: {
            error:            true,
            rejection_cause:  "response_invalid",
            explain:          "Timeline trust surface response shape invalid.",
          },
        });
        return;
      }
      setState({ status: "ready", timeline_trust: success.timeline_trust });
    } catch {
      setState({
        status:       "error",
        httpStatus:   0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:
            "Could not reach timeline trust API. Check that the API server is running.",
        },
      });
    }
  }, [job_id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
