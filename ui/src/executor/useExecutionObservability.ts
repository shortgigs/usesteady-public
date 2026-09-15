/**
 * Sole execution observability API paths (read-only projections).
 * @see docs/product/executor-execution-observability-explainability-contract-v1.md
 */

import { useCallback, useState } from "react";
import type {
  ExecutionExplainabilityRecord,
  ExecutionTimelineProjection,
  ExecutionTraceProjection,
  ExecutorRouteErrorEnvelope,
  ObservabilityExplainSuccessBody,
  ObservabilityTimelineSuccessBody,
  ObservabilityTraceSuccessBody,
} from "./types.js";

export const OBSERVABILITY_TRACE_PATH_PREFIX = "/api/executor/observability/trace";
export const OBSERVABILITY_TIMELINE_PATH_PREFIX = "/api/executor/observability/timeline";
export const OBSERVABILITY_EXPLAIN_PATH_PREFIX = "/api/executor/observability/explain";

export type ExecutionObservabilityState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | {
      readonly status: "ready";
      readonly trace: ExecutionTraceProjection;
      readonly timeline: ExecutionTimelineProjection;
      readonly explain: ExecutionExplainabilityRecord;
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

function observabilityUrl(prefix: string, job_id: string): string {
  return `${prefix}/${encodeURIComponent(job_id)}`;
}

export function useExecutionObservability() {
  const [state, setState] = useState<ExecutionObservabilityState>({ status: "idle" });

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const loadForJob = useCallback(async (job_id: string) => {
    setState({ status: "loading" });
    try {
      const [traceRes, timelineRes, explainRes] = await Promise.all([
        fetch(observabilityUrl(OBSERVABILITY_TRACE_PATH_PREFIX, job_id)),
        fetch(observabilityUrl(OBSERVABILITY_TIMELINE_PATH_PREFIX, job_id)),
        fetch(observabilityUrl(OBSERVABILITY_EXPLAIN_PATH_PREFIX, job_id)),
      ]);

      const traceJson: unknown = await traceRes.json().catch(() => null);
      const timelineJson: unknown = await timelineRes.json().catch(() => null);
      const explainJson: unknown = await explainRes.json().catch(() => null);

      if (!traceRes.ok) {
        setState({
          status:     "error",
          httpStatus: traceRes.status,
          envelope: isErrorEnvelope(traceJson)
            ? traceJson
            : {
                error:           true,
                rejection_cause: "request_failed",
                explain:         `Trace request failed (${traceRes.status}).`,
              },
        });
        return;
      }
      if (!timelineRes.ok) {
        setState({
          status:     "error",
          httpStatus: timelineRes.status,
          envelope: isErrorEnvelope(timelineJson)
            ? timelineJson
            : {
                error:           true,
                rejection_cause: "request_failed",
                explain:         `Timeline request failed (${timelineRes.status}).`,
              },
        });
        return;
      }
      if (!explainRes.ok) {
        setState({
          status:     "error",
          httpStatus: explainRes.status,
          envelope: isErrorEnvelope(explainJson)
            ? explainJson
            : {
                error:           true,
                rejection_cause: "request_failed",
                explain:         `Explain request failed (${explainRes.status}).`,
              },
        });
        return;
      }

      setState({
        status:   "ready",
        trace:    (traceJson as ObservabilityTraceSuccessBody).trace,
        timeline: (timelineJson as ObservabilityTimelineSuccessBody).timeline,
        explain:  (explainJson as ObservabilityExplainSuccessBody).explain,
      });
    } catch {
      setState({
        status:     "error",
        httpStatus: 0,
        envelope: {
          error:           true,
          rejection_cause: "network_error",
          explain:
            "Could not reach execution observability APIs. Check that the API server is running.",
        },
      });
    }
  }, []);

  return { state, reset, loadForJob };
}
