import type { MutationAuthorizationState as MutationAuthState } from "../useMutationAuthorization.js";
import type { ExecutorRouteErrorEnvelope } from "../types.js";
import { ApplyFixErrorState } from "./ApplyFixErrorState.js";

type Props = {
  readonly state: MutationAuthState;
  readonly onRetryIntent?: () => void;
  readonly onRetryAuthorization?: () => void;
};

function IntentErrorBlock(props: {
  readonly envelope: ExecutorRouteErrorEnvelope;
  readonly httpStatus: number;
  readonly onRetry?: () => void;
}) {
  return (
    <ApplyFixErrorState
      envelope={props.envelope}
      httpStatus={props.httpStatus}
      onRetry={props.onRetry}
    />
  );
}

/**
 * Loading / error / empty / accepted states for mutation authorization flow.
 */
export function MutationAuthorizationStateDisplay({
  state,
  onRetryIntent,
  onRetryAuthorization,
}: Props) {
  if (state.status === "idle") {
    return (
      <p className="text-xs text-gray-500" role="status">
        Submit a validated mutation intent to continue the authorization request path.
      </p>
    );
  }

  if (state.status === "intent_loading" || state.status === "authorization_loading") {
    return (
      <div
        role="status"
        className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-6 text-sm text-gray-400 animate-pulse"
      >
        {state.status === "intent_loading"
          ? "Validating mutation intent…"
          : "Submitting authorization request…"}
      </div>
    );
  }

  if (state.status === "intent_error") {
    return (
      <IntentErrorBlock
        envelope={state.envelope}
        httpStatus={state.httpStatus}
        onRetry={onRetryIntent}
      />
    );
  }

  if (state.status === "intent_validated") {
    return (
      <div
        role="status"
        className="rounded-lg border border-cyan-800/30 bg-cyan-950/20 px-4 py-3 space-y-1"
      >
        <p className="text-sm text-cyan-100">Mutation intent validated</p>
        <p className="text-xs text-gray-500 font-mono">
          {state.result.intent_idempotency_key}
          {state.result.idempotent_replay ? " (replay)" : ""}
        </p>
        <p className="text-xs text-gray-400">
          Confirm operator authorization below to submit the request bundle. Authority mint and
          worker chain remain on the operator path only.
        </p>
      </div>
    );
  }

  if (state.status === "authorization_error") {
    return (
      <IntentErrorBlock
        envelope={state.envelope}
        httpStatus={state.httpStatus}
        onRetry={onRetryAuthorization}
      />
    );
  }

  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-800/30 bg-emerald-950/20 px-4 py-3 space-y-2"
    >
      <p className="text-sm font-medium text-emerald-100">Authorization request accepted</p>
      <p className="text-xs text-gray-300 leading-relaxed">{state.result.note}</p>
      <p className="text-xs text-gray-500 font-mono">
        {state.result.authorization_request_id}
        {state.result.idempotent_replay ? " (replay)" : ""}
      </p>
      <p className="text-xs text-gray-500">
        No execution occurred. A granted ExecutionAuthorityRecord and WorkerResultRecord appear
        only after operator mint and worker processing on separate paths.
      </p>
    </div>
  );
}
