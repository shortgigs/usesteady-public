/**
 * src/shell/repl-guide-presenter.ts
 *
 * usesteady-public#81-A Option B — REPL-only presentation layer.
 *
 * When the interactive cursor REPL surfaces `not_execute` (intake guide/clarify),
 * replace slot-shaped headlines ("Which file?", "Which operation?") with an
 * honest single-line contract. No state, no slot memory, no authority.
 *
 * Workflow, web UI, and `renderCursorFrame()` itself are unchanged.
 */

import type { CursorSessionState } from "../product/cursor-product-session.js";
import type { ShellFrame } from "./types.js";
import { renderCursorFrame } from "./render.js";

/** Primary directive — replaces slot-shaped intake headlines in REPL only. */
export const REPL_CANONICAL_HEADLINE =
  "I need a complete instruction in one line.";

/** Fixed examples; governance-aligned with OPERATION_REGISTRY formats. */
export const REPL_CANONICAL_EXAMPLES: readonly string[] = [
  "delete file b.ts",
  "rename a.ts to b.ts",
  "create file src/x.ts",
  "run npm test",
];

export const REPL_CANONICAL_SUMMARY = [
  "Partial answers on separate lines are not combined.",
  "Examples:",
  ...REPL_CANONICAL_EXAMPLES.map((ex) => `- ${ex}`),
].join("\n");

/**
 * Render a cursor session for the interactive REPL loop.
 * Applies canonical guidance copy for `not_execute` only; all other phases
 * delegate to `renderCursorFrame` unchanged.
 */
export function renderReplCursorFrame(state: CursorSessionState): ShellFrame {
  if (state.phase !== "not_execute") {
    return renderCursorFrame(state);
  }

  return renderCursorFrame({
    ...state,
    display: {
      ...state.display,
      headline:      REPL_CANONICAL_HEADLINE,
      changeSummary: REPL_CANONICAL_SUMMARY,
    },
  });
}
