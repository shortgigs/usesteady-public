/**
 * Sole client API path: POST /api/executor/apply-fix-preview (presentation only).
 */

import { useCallback, useState } from "react";
import type {
  ApplyFixPreviewRequest,
  ApplyFixViewModel,
  ExecutorRouteErrorEnvelope,
} from "../types.js";

const PREVIEW_PATH = "/api/executor/apply-fix-preview";

export type ApplyFixPreviewState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "error";
      readonly envelope: ExecutorRouteErrorEnvelope;
      readonly httpStatus: number;
    }
  | { readonly status: "success"; readonly view: ApplyFixViewModel };

function isErrorEnvelope(value: unknown): value is ExecutorRouteErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o["error"] === true &&
    typeof o["rejection_cause"] === "string" &&
    typeof o["explain"] === "string"
  );
}

export function useApplyFixPreview() {
  const [state, setState] = useState<ApplyFixPreviewState>({ status: "idle" });

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const fetchPreview = useCallback(async (request: ApplyFixPreviewRequest) => {
    setState({ status: "loading" });
    try {
      const res = await fetch(PREVIEW_PATH, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(request),
      });

      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        if (isErrorEnvelope(body)) {
          setState({ status: "error", envelope: body, httpStatus: res.status });
          return;
        }
        setState({
          status: "error",
          httpStatus: res.status,
          envelope: {
            error:            true,
            rejection_cause:  "request_failed",
            explain:          `Preview request failed (${res.status}).`,
          },
        });
        return;
      }

      setState({ status: "success", view: body as ApplyFixViewModel });
    } catch {
      setState({
        status:   "error",
        httpStatus: 0,
        envelope: {
          error:            true,
          rejection_cause:  "network_error",
          explain:          "Could not reach the preview API. Check that the API server is running.",
        },
      });
    }
  }, []);

  return { state, fetchPreview, reset };
}
