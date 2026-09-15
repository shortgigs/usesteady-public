/**
 * Phase 9A: Claude shell advance functions.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure (or async-pure) functions that map a user answer + current Claude
 *   session state → next session state. Mirror of cursor-shell.ts for Claude.
 *
 * ── What these functions do ───────────────────────────────────────────────────
 *
 *   advanceClaudeOnConfirm — handles "confirm" prompt answers (y/n).
 *     - From "conflict":  y → acceptClaudeConflict() → back to "prepared"
 *                         n → rejectClaude()
 *     - From "prepared":  y → approveClaude() then immediately deliverClaude()
 *                         n → rejectClaude()
 *
 *   advanceClaudeOnChoice — handles "choose" prompt answers (1-N).
 *     - From "scope_question": resolves the candidate file, calls answerClaudeScope(),
 *       which returns "prepared" with a newly bound artifact. Fresh approval required.
 *     - Out-of-range index: returns state unchanged (re-prompt).
 *
 * ── Design note ───────────────────────────────────────────────────────────────
 *
 *   Same approve-then-deliver combination as cursor-shell.ts.
 *   approveClaude() and deliverClaude() remain distinct session transitions
 *   (P3, P4). The CLI collapses them into one user action for the same reason.
 *
 * ── What these functions are NOT ──────────────────────────────────────────────
 *
 *   NOT authority layers — all decisions are delegated to session functions.
 *   NOT renderers — rendering is in render.ts.
 *   NOT stateful — they return new state; they do not mutate.
 */

import type { ClaudeSessionState } from "../product/claude-product-session.js";
import type { ClaudeAgentPlugin }  from "../claude/delivery-gate.js";
import type { ClaudeGateDeps }     from "../claude/delivery-gate.js";
import {
  approveClaude,
  rejectClaude,
  acceptClaudeConflict,
  answerClaudeScope,
  deliverClaude,
} from "../product/claude-product-session.js";

// ─── Confirm advance (y/n) ────────────────────────────────────────────────────

/**
 * Advance the Claude session based on a yes/no answer.
 *
 * Called when `renderClaudeFrame(state).prompt.kind === "confirm"`.
 *
 * @param state    Current session state (must be "prepared" or "conflict").
 * @param yes      true = user said yes; false = user said no.
 * @param plugin   The Claude agent plugin for delivery.
 * @param storeDir UCP store directory for envelope persistence.
 * @param deps     Optional gate dependencies (for test injection).
 */
export async function advanceClaudeOnConfirm(
  state:    ClaudeSessionState,
  yes:      boolean,
  plugin:   ClaudeAgentPlugin,
  storeDir: string,
  deps?:    ClaudeGateDeps,
): Promise<ClaudeSessionState> {
  if (!yes) return rejectClaude(state);

  if (state.phase === "conflict") {
    return acceptClaudeConflict(state);
  }

  if (state.phase === "prepared") {
    const approved = approveClaude(state);
    return deliverClaude(approved, plugin, storeDir, deps);
  }

  return state;
}

// ─── Choice advance (1-N selection) ──────────────────────────────────────────

/**
 * Advance the Claude session based on a numbered scope candidate selection.
 *
 * Called when `renderClaudeFrame(state).prompt.kind === "choose"`.
 *
 * @param state      Current session state (must be "scope_question").
 * @param choiceIdx  1-based index into `state.scopeQuestion.candidates`.
 * @param plugin     The Claude agent plugin for delivery.
 * @param storeDir   UCP store directory for envelope persistence.
 * @param deps       Optional gate dependencies (for test injection).
 * @returns          Next session state. If choiceIdx is out of range,
 *                   returns state unchanged so the CLI can re-prompt.
 */
export async function advanceClaudeOnChoice(
  state:     ClaudeSessionState,
  choiceIdx: number,
  plugin:    ClaudeAgentPlugin,
  storeDir:  string,
  deps?:     ClaudeGateDeps,
): Promise<ClaudeSessionState> {
  const candidates = state.scopeQuestion?.candidates ?? [];
  const file       = candidates[choiceIdx - 1];

  if (!file) return state;

  return answerClaudeScope(state, file);
}
