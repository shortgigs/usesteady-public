import { useCallback, useId, useState } from "react";
import type { ApplyFixViewModel } from "../types.js";
import { MUTATION_REQUEST_AUTHORITY_BANNER } from "../types.js";

type Props = {
  readonly view: ApplyFixViewModel;
  readonly disabled: boolean;
  readonly onSubmitIntent: () => void;
};

/**
 * Operator-initiated mutation intent (presentation request only).
 */
export function MutationIntentPanel({ view, disabled, onSubmitIntent }: Props) {
  const [operatorAck, setOperatorAck] = useState(false);
  const headingId = useId();

  const onSubmit = useCallback(() => {
    if (!operatorAck) return;
    onSubmitIntent();
  }, [operatorAck, onSubmitIntent]);

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/40 px-4 py-4"
    >
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-wider text-gray-500"
      >
        Mutation intent
      </h2>

      <div
        role="status"
        className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90"
      >
        {MUTATION_REQUEST_AUTHORITY_BANNER}
      </div>

      <dl className="grid gap-2 text-sm text-gray-400">
        <div>
          <dt className="text-xs text-gray-500">Summary</dt>
          <dd className="text-gray-300">{view.intent_summary}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Target scope</dt>
          <dd className="font-mono text-xs text-gray-300">
            {view.target_scope.join(", ")}
          </dd>
        </div>
      </dl>

      <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={operatorAck}
          onChange={(e) => setOperatorAck(e.target.checked)}
          className="mt-1 min-w-[16px] min-h-[16px]"
          disabled={disabled}
        />
        <span>I confirm this mutation intent for review (no execution from this surface).</span>
      </label>

      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || !operatorAck}
        className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg
                   border border-gray-700 text-gray-200
                   hover:bg-gray-900/60 disabled:opacity-40 disabled:cursor-not-allowed
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
      >
        Submit mutation intent
      </button>
    </section>
  );
}
