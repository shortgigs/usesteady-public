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
/** Primary directive — replaces slot-shaped intake headlines in REPL only. */
export declare const REPL_CANONICAL_HEADLINE = "I need a complete instruction in one line.";
/** Fixed examples; governance-aligned with OPERATION_REGISTRY formats. */
export declare const REPL_CANONICAL_EXAMPLES: readonly string[];
export declare const REPL_CANONICAL_SUMMARY: string;
/**
 * Render a cursor session for the interactive REPL loop.
 * Applies canonical guidance copy for `not_execute` only; all other phases
 * delegate to `renderCursorFrame` unchanged.
 */
export declare function renderReplCursorFrame(state: CursorSessionState): ShellFrame;
//# sourceMappingURL=repl-guide-presenter.d.ts.map