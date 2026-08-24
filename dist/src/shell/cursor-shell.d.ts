/**
 * Phase 9A: Cursor shell advance functions.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure (or async-pure) functions that map a user answer + current session
 *   state → next session state. These are the seam between the I/O layer
 *   (readline, test, UI) and the CursorProductSession API.
 *
 * ── What these functions do ───────────────────────────────────────────────────
 *
 *   advanceCursorOnConfirm — handles "confirm" prompt answers (y/n).
 *     - From "conflict":  y → acceptConflict() → back to "prepared"
 *                         n → reject()
 *     - From "prepared":  y → approve() then immediately deliver()
 *                         n → reject()
 *
 *   advanceCursorOnChoice — handles "choose" prompt answers (1-N).
 *     - From "scope_question": resolves the candidate file, calls answerScope(),
 *       then immediately delivers (answerScope → "approved" → deliver).
 *     - Out-of-range index: returns state unchanged (re-prompt).
 *
 * ── Design note ───────────────────────────────────────────────────────────────
 *
 *   The approve → deliver combination is intentional at the CLI level.
 *   The session still performs them as two distinct transitions (P3, P4).
 *   The CLI collapses them into one user action because "I approved it, now
 *   run it" is the correct product-shell semantic. The intermediate "approved"
 *   state is not shown to the user — it is internal to the transition.
 *
 * ── What these functions are NOT ──────────────────────────────────────────────
 *
 *   NOT authority layers — all decisions are delegated to session functions.
 *   NOT renderers — rendering is in render.ts.
 *   NOT stateful — they return new state; they do not mutate.
 */
import type { CursorSessionState } from "../product/cursor-product-session.js";
import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
/**
 * Advance the session based on a yes/no answer to the current confirm prompt.
 *
 * Called when `renderCursorFrame(state).prompt.kind === "confirm"`.
 *
 * @param state    Current session state (must be "prepared" or "conflict").
 * @param yes      true = user said yes; false = user said no.
 * @param plugin   The Cursor editor plugin for delivery.
 * @param storeDir UCP store directory for envelope persistence.
 */
export declare function advanceCursorOnConfirm(state: CursorSessionState, yes: boolean, plugin: CursorEditorPlugin, storeDir: string): Promise<CursorSessionState>;
/**
 * Advance the session based on a numbered choice for scope clarification.
 *
 * Called when `renderCursorFrame(state).prompt.kind === "choose"`.
 *
 * @param state      Current session state (must be "scope_question").
 * @param choiceIdx  1-based index into `state.scopeQuestion.candidates`.
 * @param plugin     The Cursor editor plugin for delivery.
 * @param storeDir   UCP store directory for envelope persistence.
 * @returns          Next session state. If choiceIdx is out of range,
 *                   returns state unchanged so the CLI can re-prompt.
 */
export declare function advanceCursorOnChoice(state: CursorSessionState, choiceIdx: number, plugin: CursorEditorPlugin, storeDir: string): Promise<CursorSessionState>;
//# sourceMappingURL=cursor-shell.d.ts.map