/**
 * Phase 9A: Shell rendering.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure functions that map session state → ShellFrame.
 *   No I/O. No session transitions. No authority.
 *
 * ── Display contract ──────────────────────────────────────────────────────────
 *
 *   Every frame has:
 *     - A phase header (runtime + phase name)
 *     - One or more content lines (from session.display)
 *     - An optional prompt (matched to the phase's expected next action)
 *
 *   Terminal phases produce no prompt.
 *   "approved" produces no prompt — the CLI advance functions call deliver
 *   immediately after approve, so this phase is not surfaced to the user.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a state machine — it reads phase and display; it does not modify them.
 *   NOT an authority layer — it reflects what the session already decided.
 */
import type { CursorSessionState } from "../product/cursor-product-session.js";
import type { ClaudeSessionState } from "../product/claude-product-session.js";
import type { ShellFrame } from "./types.js";
/**
 * Render a Cursor product session state into a ShellFrame.
 *
 * The returned frame is ready to print and optionally prompt.
 * No session state is modified.
 */
export declare function renderCursorFrame(state: CursorSessionState): ShellFrame;
/**
 * Render a Claude product session state into a ShellFrame.
 *
 * The returned frame is ready to print and optionally prompt.
 * No session state is modified.
 */
export declare function renderClaudeFrame(state: ClaudeSessionState): ShellFrame;
//# sourceMappingURL=render.d.ts.map