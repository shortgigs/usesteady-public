/**
 * Session Staleness — Phase 6C.
 *
 * Annotates a session as fresh, stale-approved, or stale-other based on
 * elapsed time since the session entered the "prepared" phase.
 *
 * ── Authority constraint ──────────────────────────────────────────────────────
 *
 *   Staleness is ANNOTATION ONLY. It has zero routing authority.
 *   It does not block any transition. It does not change isTerminal().
 *   It does not auto-approve or auto-deliver anything.
 *   It only answers the question: "how old is this session?"
 *
 * ── stale_approved semantics ─────────────────────────────────────────────────
 *
 *   stale_approved applies only to "approved"-phase sessions.
 *   It signals that H approved some time ago but delivery has not happened,
 *   which is the highest-risk staleness pattern (approved but undelivered).
 *
 *   stale_approved is NOT terminal. The session can still be delivered.
 *   The caller decides whether to surface the warning, prompt re-approval, etc.
 *
 * ── stale_other semantics ────────────────────────────────────────────────────
 *
 *   stale_other applies to non-terminal, non-approved sessions that have
 *   exceeded the staleness threshold. Lower severity than stale_approved.
 *
 *   Terminal sessions always return "fresh" (they are complete; staleness
 *   is not a meaningful concept for finalized sessions).
 */

import type { CursorSessionState } from "../cursor-product-session.js";
import { isTerminal } from "../cursor-product-session.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * SessionStaleness — the staleness annotation for a session.
 *
 *   fresh          — session is within the acceptable time window.
 *   stale_approved — session is in "approved" phase and has exceeded the threshold.
 *                    Highest-risk pattern: approved but undelivered for too long.
 *   stale_other    — session is in a non-approved live phase and has exceeded the threshold.
 */
export type SessionStaleness = "fresh" | "stale_approved" | "stale_other";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate the staleness of a session.
 *
 * @param state        The session state to evaluate.
 * @param now          Current Unix timestamp in ms.
 * @param staleAfterMs Age threshold in ms. Sessions older than this are stale.
 *
 * Returns "fresh" for terminal sessions (terminal = done; not meaningfully stale).
 * Returns "fresh" when preparedAt is absent (no timestamp → cannot be stale).
 * Returns "stale_approved" when phase is "approved" and age > threshold.
 * Returns "stale_other" for other live phases when age > threshold.
 */
export function evaluateSessionStaleness(
  state:        CursorSessionState,
  now:          number,
  staleAfterMs: number,
): SessionStaleness {
  // Terminal sessions are complete — staleness does not apply.
  if (isTerminal(state)) return "fresh";

  // Need a preparedAt timestamp to measure age.
  const preparedAt = state.preparedAt;
  if (preparedAt === undefined) return "fresh";

  const age = now - preparedAt;
  if (age <= staleAfterMs) return "fresh";

  // "approved" is the most critical staleness case (approved but undelivered).
  if (state.phase === "approved") return "stale_approved";

  // All other live phases (prepared, conflict, scope_question, idle).
  return "stale_other";
}
