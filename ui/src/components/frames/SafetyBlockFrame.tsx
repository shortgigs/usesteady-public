/**
 * Trust Surface Model, Phase 2 (single-authority safety): SafetyBlockFrame.
 *
 * Renders when POST /api/workflow/start returns a `safetyBlock` instead of a
 * run: the single-authority safety gate (the same gate the CLI applies)
 * refused the request. No run exists; nothing can be approved or executed
 * from this surface.
 *
 * Authority: none. This frame only reports the safety verdict. There is no
 * approve/override path here — safety is a constraint authority, and a block
 * is terminal for this request. The user revises the request and starts over.
 */

import { Button } from "../ui/Button.js";
import type { SafetyBlock } from "../../api/types.js";

type Props = {
  readonly block:    SafetyBlock;
  readonly onCancel: () => void;
};

export function SafetyBlockFrame({ block, onCancel }: Props): JSX.Element {
  return (
    <div className="flex items-center justify-center min-h-full bg-gray-950 p-6">
      <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-gray-900/60 p-6 shadow-lg">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-400">
          Blocked by safety
        </div>

        <p className="mb-4 font-mono text-xs text-gray-500">
          You asked: <span className="text-gray-300">{block.blockedInput}</span>
        </p>

        <p className="mb-2 text-base text-gray-100">{block.note}</p>

        <p className="mb-5 text-xs text-gray-500">
          Safety is one authority across UseSteady. Nothing runs and no plan was
          created. Revise the request to remove the unsafe operation, then start
          over.
        </p>

        <Button
          label="Start over"
          variant="primary"
          className="w-full justify-center sm:w-auto"
          onClick={onCancel}
        />
      </div>
    </div>
  );
}
