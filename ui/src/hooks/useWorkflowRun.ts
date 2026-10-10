/**
 * Phase 11A-Web: useWorkflowRun hook.
 *
 * Owns: RunResponse state, loading/error, action dispatch.
 *
 * Calls the frozen advance functions via the API client.
 * Never re-derives meaning from run state — delegates to frame components.
 *
 * Architecture: React holds selected objects + loading/error only.
 * The state machine lives in the domain layer (server-side coordinator).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  startWorkflow,
  confirmWorkflow,
  chooseWorkflow,
  confirmUnderstanding as confirmUnderstandingApi,
} from "../api/client.js";
import {
  isClarifyResponse,
  isSafetyBlockResponse,
  type RunResponse,
  type WorkflowSpec,
  type ConfirmedUnderstandingV1,
  type ClarifyPrompt,
  type SafetyBlock,
  type RoutingSurface,
} from "../api/types.js";

type State =
  | { status: "idle" }
  | { status: "loading"; runId?: string }
  | { status: "ready"; response: RunResponse }
  // `surface` (Phase 3B) — the RoutingSurface engine object the web renderer
  // dispatches on. Always present from the server; a fallback is constructed in
  // case an older response omits it. `prompt`/`block` are retained for the
  // fallback construction only.
  | { status: "clarify"; prompt: ClarifyPrompt; surface: RoutingSurface; spec: WorkflowSpec; opts?: StartOpts }
  | { status: "safety_block"; block: SafetyBlock; surface: RoutingSurface }
  | { status: "error"; error: string };

/** Build a RoutingSurface from a legacy safety-block payload (3B fallback). */
function safetySurfaceFromBlock(block: SafetyBlock): RoutingSurface {
  return {
    type: "safety",
    reason: block.reason,
    note: block.note,
    blockedInput: block.blockedInput,
    ...(block.matchedPattern !== undefined ? { matchedPattern: block.matchedPattern } : {}),
    ...(block.detectorId !== undefined ? { detectorId: block.detectorId } : {}),
  };
}

/** Build a RoutingSurface from a legacy clarify prompt (3B fallback). */
function clarifySurfaceFromPrompt(prompt: ClarifyPrompt): RoutingSurface {
  return {
    type: "clarify",
    clarify: {
      mode: "slot_fill",
      kind: prompt.kind,
      slot: prompt.slot,
      prompt: prompt.prompt,
      originalInput: prompt.originalInput,
    },
  };
}

export type StartOpts = {
  workspaceRoot?:    string;
  mode?:             "normal" | "break_glass";
  breakGlassReason?: string;
};

export type WorkflowRunHandle = {
  state:     State;
  start:     (spec: WorkflowSpec, opts?: StartOpts) => Promise<void>;
  confirm:   (yes: boolean) => Promise<void>;
  confirmUnderstanding: (confirmed: ConfirmedUnderstandingV1) => Promise<void>;
  choose:    (idx: number)  => Promise<void>;
  /** Answer an outstanding clarify prompt; re-submits start with the answer. */
  clarifyAnswer: (answer: string) => Promise<void>;
  reset:     () => void;
};

export function useWorkflowRun(): WorkflowRunHandle {
  const [state, setState] = useState<State>({ status: "idle" });

  // ── SSE subscription (PI-4 Iter 3) ───────────────────────────────────────
  //
  // When a runId becomes known (ready or loading-with-runId), open an
  // EventSource connection to GET /api/workflow/:runId/events.
  //
  // Invariants:
  //   - SSE events are silently dropped while status === "loading"
  //     (an in-flight POST action is authoritative; let it win).
  //   - Both paths (SSE and POST response) produce identical data,
  //     so a double-update is idempotent and causes no visible flicker.
  //   - On connection error, SSE closes gracefully; the POST-based flow
  //     continues to work without any SSE (fallback is automatic).
  //   - The effect is keyed on activeRunId; useEffect cleanup closes the
  //     EventSource when the runId changes (new workflow) or resets to idle.

  const eventSourceRef = useRef<EventSource | null>(null);

  const activeRunId: string | undefined =
    state.status === "ready"   ? state.response.runId :
    state.status === "loading" ? (state as { runId?: string }).runId :
    undefined;

  useEffect(() => {
    if (!activeRunId) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    const es = new EventSource(`/api/workflow/${activeRunId}/events`);
    eventSourceRef.current = es;

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as RunResponse;
        setState((current) => {
          // POST response is authoritative while an action is in-flight.
          if (current.status === "loading") return current;
          return { status: "ready", response: data };
        });
      } catch {
        // Malformed event payload — ignore, stay in current state.
      }
    };

    es.onerror = () => {
      // SSE connection error — close and fall back to POST-only flow.
      // No retry: if the run is still active, the user's next POST action
      // will return the current state as usual.
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };

    return () => {
      es.close();
      if (eventSourceRef.current === es) eventSourceRef.current = null;
    };
  }, [activeRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dispatch = useCallback(async (
    runId: string | undefined,
    action: () => Promise<RunResponse>,
  ) => {
    setState(s => ({ status: "loading", runId: runId ?? (s as { runId?: string }).runId }));
    try {
      const response = await action();
      setState({ status: "ready", response });
    } catch (err) {
      setState({ status: "error", error: (err as Error).message });
    }
  }, []);

  const start = useCallback(async (spec: WorkflowSpec, opts?: StartOpts) => {
    setState({ status: "loading" });
    try {
      const response = await startWorkflow(
        spec, opts?.workspaceRoot, opts?.mode, opts?.breakGlassReason,
      );
      if (isSafetyBlockResponse(response)) {
        setState({
          status: "safety_block",
          block: response.safetyBlock,
          surface: response.routingSurface ?? safetySurfaceFromBlock(response.safetyBlock),
        });
      } else if (isClarifyResponse(response)) {
        setState({
          status: "clarify",
          prompt: response.clarify,
          surface: response.routingSurface ?? clarifySurfaceFromPrompt(response.clarify),
          spec,
          ...(opts ? { opts } : {}),
        });
      } else {
        setState({ status: "ready", response });
      }
    } catch (err) {
      setState({ status: "error", error: (err as Error).message });
    }
  }, []);

  const clarifyAnswer = useCallback(async (answer: string) => {
    setState((current) => {
      if (current.status !== "clarify") return current;
      const { spec, opts } = current;
      // Re-submit start with the answer. The server reconstructs + re-routes
      // through normalizeNLToIR; a WILL is produced solely by that re-parse.
      void (async () => {
        try {
          const response = await startWorkflow(
            spec, opts?.workspaceRoot, opts?.mode, opts?.breakGlassReason, answer,
          );
          if (isSafetyBlockResponse(response)) {
            setState({
              status: "safety_block",
              block: response.safetyBlock,
              surface: response.routingSurface ?? safetySurfaceFromBlock(response.safetyBlock),
            });
          } else if (isClarifyResponse(response)) {
            setState({
              status: "clarify",
              prompt: response.clarify,
              surface: response.routingSurface ?? clarifySurfaceFromPrompt(response.clarify),
              spec,
              ...(opts ? { opts } : {}),
            });
          } else {
            setState({ status: "ready", response });
          }
        } catch (err) {
          setState({ status: "error", error: (err as Error).message });
        }
      })();
      return { status: "loading" };
    });
  }, []);

  const confirm = useCallback(async (yes: boolean) => {
    const runId = state.status === "ready" ? state.response.runId : undefined;
    if (!runId) return;
    await dispatch(runId, () => confirmWorkflow(runId, yes));
  }, [state, dispatch]);

  const confirmUnderstanding = useCallback(async (confirmed: ConfirmedUnderstandingV1) => {
    const runId = state.status === "ready" ? state.response.runId : undefined;
    if (!runId) return;
    await dispatch(runId, () => confirmUnderstandingApi(runId, confirmed));
  }, [state, dispatch]);

  const choose = useCallback(async (idx: number) => {
    const runId = state.status === "ready" ? state.response.runId : undefined;
    if (!runId) return;
    await dispatch(runId, () => chooseWorkflow(runId, idx));
  }, [state, dispatch]);

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, start, confirm, confirmUnderstanding, choose, clarifyAnswer, reset };
}
