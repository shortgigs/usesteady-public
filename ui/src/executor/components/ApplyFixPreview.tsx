import { useCallback, useEffect, useId, useState } from "react";
import type { ApplyFixPreviewRequest } from "../types.js";
import { useApplyFixPreview } from "../hooks/useApplyFixPreview.js";
import { useMutationAuthorization } from "../useMutationAuthorization.js";
import { useWorkerChainStatus } from "../useWorkerChainStatus.js";
import { useExecutionObservability } from "../useExecutionObservability.js";
import { WorkerExecutionStatus } from "./WorkerExecutionStatus.js";
import { WorkerExecutionTimeline } from "./WorkerExecutionTimeline.js";
import { ExecutionTraceView } from "./ExecutionTraceView.js";
import { ExecutionTimelineView } from "./ExecutionTimelineView.js";
import { ExecutionExplainabilityView } from "./ExecutionExplainabilityView.js";
import { ApplyFixAuthorityBanner } from "./ApplyFixAuthorityBanner.js";
import { ApplyFixHeader } from "./ApplyFixHeader.js";
import { ApplyFixLineage } from "./ApplyFixLineage.js";
import { ApplyFixExplanation } from "./ApplyFixExplanation.js";
import { ApplyFixNextStep } from "./ApplyFixNextStep.js";
import { ApplyFixSkeleton } from "./ApplyFixSkeleton.js";
import { ApplyFixEmptyState } from "./ApplyFixEmptyState.js";
import { ApplyFixErrorState } from "./ApplyFixErrorState.js";
import { MutationIntentPanel } from "./MutationIntentPanel.js";
import { MutationAuthorizationStateDisplay } from "./MutationAuthorizationState.js";

const SAMPLE_REQUEST_HINT = `{
  "eligibility": { ... },
  "operator_confirmation": true,
  "capability_handler_id": "handler.recheck_portal_domain",
  "ledger_actor": { "kind": "operator", "actor_id": "operator.example" },
  "store_dir": "/path/to/store",
  "job_kind": "replay_notify",
  "executed_at": "2026-05-26T14:05:00.000Z"
}`;

type Props = {
  /** When set, operator can load preview without pasting JSON. */
  initialRequest?: ApplyFixPreviewRequest | null;
};

export function ApplyFixPreview({ initialRequest = null }: Props) {
  const { state, fetchPreview, reset } = useApplyFixPreview();
  const {
    state: mutationState,
    reset: resetMutation,
    submitIntent,
    submitAuthorizationRequest,
  } = useMutationAuthorization();
  const [requestJson, setRequestJson] = useState(
    () => (initialRequest ? JSON.stringify(initialRequest, null, 2) : ""),
  );
  const [authOperatorConfirmed, setAuthOperatorConfirmed] = useState(false);
  const [mintOperatorConfirmed, setMintOperatorConfirmed] = useState(false);
  const requestAreaId = useId();
  const mutationSectionId = useId();
  const workerChainSectionId = useId();
  const observabilitySectionId = useId();
  const {
    state: workerState,
    reset: resetWorkerChain,
    submitIntake,
    refreshStatus,
  } = useWorkerChainStatus();
  const {
    state: observabilityState,
    reset: resetObservability,
    loadForJob: loadObservability,
  } = useExecutionObservability();

  useEffect(() => {
    resetMutation();
    resetWorkerChain();
    resetObservability();
    setAuthOperatorConfirmed(false);
    setMintOperatorConfirmed(false);
  }, [state.status, resetMutation, resetWorkerChain, resetObservability]);

  const parseRequest = useCallback((): ApplyFixPreviewRequest | null => {
    try {
      const parsed = JSON.parse(requestJson) as ApplyFixPreviewRequest;
      if (parsed.operator_confirmation !== true) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [requestJson]);

  const onLoadPreview = useCallback(() => {
    const req = parseRequest();
    if (req) void fetchPreview(req);
  }, [parseRequest, fetchPreview]);

  const showEmpty =
    state.status === "idle" && requestJson.trim().length === 0 && !initialRequest;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6 min-w-0">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-white tracking-tight">Apply Fix preview</h1>
        <p className="text-sm text-gray-500">
          Inspection console — reads <span className="font-mono text-gray-400">ApplyFixViewModel</span> only.
        </p>
      </header>

      <ApplyFixAuthorityBanner />

      <section aria-labelledby={requestAreaId} className="space-y-3">
        <h2
          id={requestAreaId}
          className="text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          Preview request
        </h2>
        <textarea
          value={requestJson}
          onChange={(e) => setRequestJson(e.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full text-base font-mono text-sm bg-gray-950 border border-gray-800 rounded-lg
                     px-3 py-2 text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
          placeholder={SAMPLE_REQUEST_HINT}
          aria-label="Preview request JSON"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onLoadPreview}
            disabled={state.status === "loading" || !parseRequest()}
            className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg
                       bg-cyan-950/50 border border-cyan-700/50 text-cyan-100
                       hover:bg-cyan-900/40 disabled:opacity-40 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            {state.status === "loading" ? "Loading…" : "Load preview"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              setRequestJson(initialRequest ? JSON.stringify(initialRequest, null, 2) : "");
            }}
            className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400
                       hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
          >
            Clear
          </button>
        </div>
        {!parseRequest() && requestJson.trim().length > 0 && (
          <p className="text-xs text-amber-200/80" role="status">
            Request JSON is invalid or missing operator_confirmation: true.
          </p>
        )}
      </section>

      {showEmpty && (
        <ApplyFixEmptyState
          onLoadSample={() => setRequestJson(SAMPLE_REQUEST_HINT)}
        />
      )}

      {state.status === "loading" && <ApplyFixSkeleton />}

      {state.status === "error" && (
        <ApplyFixErrorState
          envelope={state.envelope}
          httpStatus={state.httpStatus}
          onRetry={parseRequest() ? onLoadPreview : undefined}
        />
      )}

      {state.status === "success" && (
        <div className="space-y-8 border-t border-gray-800/80 pt-8">
          <ApplyFixHeader view={state.view} />
          <ApplyFixLineage view={state.view} />
          <ApplyFixExplanation view={state.view} />
          <ApplyFixNextStep view={state.view} />
          <section
            aria-labelledby={mutationSectionId}
            className="space-y-4 border-t border-gray-800/80 pt-8"
          >
            <h2
              id={mutationSectionId}
              className="text-xs font-semibold uppercase tracking-wider text-gray-500"
            >
              Mutation authorization (request path)
            </h2>
            <MutationIntentPanel
              view={state.view}
              disabled={
                mutationState.status === "intent_loading" ||
                mutationState.status === "intent_validated" ||
                mutationState.status === "authorization_loading" ||
                mutationState.status === "authorization_accepted"
              }
              onSubmitIntent={() => void submitIntent(state.view)}
            />
            <MutationAuthorizationStateDisplay
              state={mutationState}
              onRetryIntent={() => void submitIntent(state.view)}
              onRetryAuthorization={
                mutationState.status === "intent_validated"
                  ? () => {
                      if (mutationState.status !== "intent_validated") return;
                      void submitAuthorizationRequest({
                        view:               state.view,
                        validated_intent:   mutationState.result.validated_intent,
                        operator_confirmed: authOperatorConfirmed,
                      });
                    }
                  : undefined
              }
            />
            {mutationState.status === "intent_validated" && (
              <div className="space-y-3 rounded-lg border border-gray-800 px-4 py-4">
                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={authOperatorConfirmed}
                    onChange={(e) => setAuthOperatorConfirmed(e.target.checked)}
                    className="mt-1 min-w-[16px] min-h-[16px]"
                    disabled={mutationState.status !== "intent_validated"}
                  />
                  <span>
                    I confirm this authorization request (operator path mint only — not
                    execution).
                  </span>
                </label>
                <button
                  type="button"
                  disabled={
                    !authOperatorConfirmed ||
                    mutationState.status !== "intent_validated"
                  }
                  onClick={() => {
                    if (mutationState.status !== "intent_validated") return;
                    void submitAuthorizationRequest({
                      view:               state.view,
                      validated_intent:   mutationState.result.validated_intent,
                      operator_confirmed: authOperatorConfirmed,
                    });
                  }}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg
                             border border-gray-700 text-gray-200
                             hover:bg-gray-900/60 disabled:opacity-40 disabled:cursor-not-allowed
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                >
                  Submit authorization request
                </button>
              </div>
            )}
            {mutationState.status === "authorization_accepted" && parseRequest() && (
              <section
                aria-labelledby={workerChainSectionId}
                className="space-y-4 border-t border-gray-800/80 pt-8"
              >
                <h2
                  id={workerChainSectionId}
                  className="text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Worker chain (server intake + status)
                </h2>
                <p className="text-xs text-gray-500">
                  Submits accepted authorization to server intake. Authority mint and worker
                  chain run on the operator path only — this surface shows descriptive status.
                </p>
                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mintOperatorConfirmed}
                    onChange={(e) => setMintOperatorConfirmed(e.target.checked)}
                    className="mt-1 min-w-[16px] min-h-[16px]"
                  />
                  <span>
                    I confirm operator mint for server intake (separate from authorization
                    request).
                  </span>
                </label>
                <button
                  type="button"
                  disabled={
                    !mintOperatorConfirmed ||
                    workerState.status === "intake_loading"
                  }
                  onClick={() => {
                    const pipeline = parseRequest();
                    if (
                      mutationState.status !== "authorization_accepted" ||
                      !pipeline
                    ) {
                      return;
                    }
                    void submitIntake({
                      authorization_request:
                        mutationState.authorization_request,
                      pipeline,
                      operator_mint_confirmed: mintOperatorConfirmed,
                    });
                  }}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg
                             border border-gray-700 text-gray-200
                             hover:bg-gray-900/60 disabled:opacity-40 disabled:cursor-not-allowed
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                >
                  {workerState.status === "intake_loading"
                    ? "Submitting intake…"
                    : "Submit server intake"}
                </button>
                {workerState.status === "intake_error" && (
                  <p className="text-sm text-amber-200/90" role="alert">
                    {workerState.envelope.explain}
                  </p>
                )}
                {(workerState.status === "intake_accepted" ||
                  workerState.status === "status_ready") && (
                  <>
                    <WorkerExecutionStatus
                      projection={
                        workerState.status === "intake_accepted"
                          ? workerState.result.projection
                          : workerState.projection
                      }
                    />
                    <WorkerExecutionTimeline
                      phase={
                        workerState.status === "intake_accepted"
                          ? workerState.result.projection.phase
                          : workerState.projection.phase
                      }
                      recorded_at={
                        workerState.status === "intake_accepted"
                          ? workerState.result.projection.recorded_at
                          : workerState.projection.recorded_at
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const jobId =
                          workerState.status === "intake_accepted"
                            ? workerState.result.job_id
                            : workerState.projection.job_id;
                        void refreshStatus(jobId);
                      }}
                      className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-gray-700
                                 text-gray-400 hover:text-gray-200
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    >
                      Refresh status projection
                    </button>
                  </>
                )}
                {workerState.status === "status_error" && (
                  <p className="text-sm text-amber-200/90" role="alert">
                    {workerState.envelope.explain}
                  </p>
                )}
                {(workerState.status === "intake_accepted" ||
                  workerState.status === "status_ready") && (
                  <section
                    aria-labelledby={observabilitySectionId}
                    className="space-y-4 border-t border-gray-800/80 pt-6 mt-6"
                  >
                    <h3
                      id={observabilitySectionId}
                      className="text-xs font-semibold uppercase tracking-wider text-gray-500"
                    >
                      Execution observability (read-only)
                    </h3>
                    <p className="text-xs text-gray-500">
                      Inspect trace, timeline, and explainability derived from stored worker
                      evidence. Projection is not authority; explainability is not execution.
                    </p>
                    <button
                      type="button"
                      disabled={observabilityState.status === "loading"}
                      onClick={() => {
                        const jobId =
                          workerState.status === "intake_accepted"
                            ? workerState.result.job_id
                            : workerState.projection.job_id;
                        void loadObservability(jobId);
                      }}
                      className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-gray-700
                                 text-gray-300 hover:bg-gray-900/60 disabled:opacity-40
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    >
                      {observabilityState.status === "loading"
                        ? "Loading observability…"
                        : "Load execution observability"}
                    </button>
                    {observabilityState.status === "error" && (
                      <p className="text-sm text-amber-200/90" role="alert">
                        {observabilityState.envelope.explain}
                      </p>
                    )}
                    {observabilityState.status === "ready" && (
                      <div className="space-y-6">
                        <ExecutionExplainabilityView explain={observabilityState.explain} />
                        <ExecutionTraceView trace={observabilityState.trace} />
                        <ExecutionTimelineView timeline={observabilityState.timeline} />
                      </div>
                    )}
                  </section>
                )}
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
