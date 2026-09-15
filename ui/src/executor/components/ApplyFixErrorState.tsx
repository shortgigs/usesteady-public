import type { ExecutorRouteErrorEnvelope } from "../types.js";

type Props = {
  envelope: ExecutorRouteErrorEnvelope;
  httpStatus: number;
  onRetry?: () => void;
};

const CAUSE_HINTS: Record<string, string> = {
  operator_confirmation_required: "Set operator_confirmation to true in the request body.",
  executor_not_allowed:         "Eligibility state must be allowed before preview.",
  executor_eligibility_expired: "Refresh capability eligibility and re-check TTL.",
  store_dir_invalid:            "Provide a non-empty store_dir path.",
  network_error:                "Start the API server (npm run serve) and retry.",
  request_failed:               "Review the rejection cause below and fix the request.",
};

export function ApplyFixErrorState({ envelope, httpStatus, onRetry }: Props) {
  const hint = CAUSE_HINTS[envelope.rejection_cause] ?? "Adjust the preview request and try again.";

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-4 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-amber-100">Preview unavailable</p>
        {httpStatus > 0 && (
          <span className="text-xs font-mono text-amber-200/70">HTTP {httpStatus}</span>
        )}
      </div>
      <p className="text-sm text-gray-200">{envelope.explain}</p>
      <dl className="text-xs space-y-1 font-mono">
        <div className="flex gap-2">
          <dt className="text-gray-500 shrink-0">cause</dt>
          <dd className="text-amber-200/90">{envelope.rejection_cause}</dd>
        </div>
      </dl>
      <p className="text-xs text-gray-400 border-t border-amber-900/40 pt-3">{hint}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-gray-600 text-gray-200
                     hover:border-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
        >
          Retry preview
        </button>
      )}
    </div>
  );
}
