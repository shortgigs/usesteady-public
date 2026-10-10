/**
 * USESTEADY_CLARIFY_THEN_PROMOTE_V1 — Phase 3/web: ClarifyFrame.
 *
 * Renders when POST /api/workflow/start returns a `clarify` prompt instead of a
 * run: the input was recoverable with exactly one missing slot (a rename
 * destination, or a file-vs-folder choice). The user supplies that one slot and
 * the page re-submits start with the answer.
 *
 * Authority: none. This frame only collects one token. Nothing runs as a result
 * of answering — the reconstructed request is re-routed through the canonical
 * parser server-side and still reaches the normal approval gate as a SYSTEM
 * WILL (or falls back to Reflection). This frame never executes anything.
 */

import { useState } from "react";
import { Button } from "../ui/Button.js";
import type { ClarifyPrompt } from "../../api/types.js";

type Props = {
  readonly prompt:   ClarifyPrompt;
  readonly onAnswer: (answer: string) => void;
  readonly onCancel: () => void;
};

export function ClarifyFrame({ prompt, onAnswer, onCancel }: Props): JSX.Element {
  const [value, setValue] = useState("");
  const canSubmit = value.trim().length > 0;

  return (
    <div className="flex items-center justify-center min-h-full bg-gray-950 p-6">
      <div className="w-full max-w-lg rounded-xl border border-[#00D4FF]/20 bg-gray-900/60 p-6 shadow-lg">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#00D4FF]">
          One quick question
        </div>

        <p className="mb-4 font-mono text-xs text-gray-500">
          You asked: <span className="text-gray-300">{prompt.originalInput}</span>
        </p>

        <p className="mb-5 text-base text-gray-100">{prompt.prompt}</p>

        {prompt.slot === "file_or_folder" ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              label="File"
              className="w-full justify-center sm:w-auto"
              onClick={() => onAnswer("file")}
            />
            <Button
              label="Folder"
              className="w-full justify-center sm:w-auto"
              onClick={() => onAnswer("folder")}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) onAnswer(value.trim());
              }}
              placeholder="new path, e.g. src/PrimaryButton.tsx"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2
                         text-base text-gray-100 placeholder-gray-600
                         focus:border-[#00D4FF]/50 focus:outline-none"
            />
            <Button
              label="Continue"
              variant="primary"
              className="w-full justify-center sm:w-auto"
              disabled={!canSubmit}
              onClick={() => { if (canSubmit) onAnswer(value.trim()); }}
            />
          </div>
        )}

        <p className="mt-5 text-xs text-gray-500">
          Answering only forms the request — you still approve it before anything runs.
        </p>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 text-xs text-gray-500 underline hover:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
