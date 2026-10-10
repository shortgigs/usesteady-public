/**
 * Session Serializer — Phase 6C.
 *
 * Serialize a CursorSessionState to a snapshot and restore it safely.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────
 *
 *   serializeSession(state, now?) → CursorSessionSnapshot
 *     Pure function. Deterministic for the same state + now value.
 *     now defaults to Date.now() when absent.
 *
 *   restoreSession(snapshot: unknown) → CursorSessionState
 *     NEVER throws. Any invalid input (wrong type, wrong version, missing
 *     fields) returns a safe "blocked" session with an explanatory headline.
 *     Does not re-run intake, delivery, or any gate logic.
 *     The restored state preserves all authority boundaries.
 *
 * ── Safe fallback policy ─────────────────────────────────────────────────────
 *
 *   "blocked" is used as the safe invalid-restore phase because:
 *     - It is already a defined terminal phase.
 *     - It communicates clearly that no action is possible.
 *     - It prevents auto-deliver: a blocked session cannot be delivered.
 *     - No new phase is needed (existing safe terminal is sufficient).
 */

import type { CursorSessionState } from "../cursor-product-session.js";
import type { CursorSessionSnapshot } from "./session-snapshot-types.js";

const BLOCKED_RESTORE: CursorSessionState = {
  phase:   "blocked",
  display: {
    headline:   "Session could not be restored. The snapshot is invalid or from an incompatible version.",
    resultNote: "Create a new session to continue.",
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Serialize a session state into a versioned snapshot.
 *
 * @param state  The session state to capture.
 * @param now    Unix timestamp in ms. Defaults to Date.now().
 */
export function serializeSession(
  state: CursorSessionState,
  now:   number = Date.now(),
): CursorSessionSnapshot {
  return { version: 1, savedAt: now, state };
}

/**
 * Restore a session state from an unknown value (e.g. parsed JSON).
 *
 * Never throws. Returns a "blocked" fallback state on any validation failure.
 *
 * @param snapshot  Any value (typically the output of JSON.parse).
 */
export function restoreSession(snapshot: unknown): CursorSessionState {
  try {
    if (!isPlainObject(snapshot)) return BLOCKED_RESTORE;

    const snap = snapshot as Record<string, unknown>;

    // Version check — must be exactly 1
    if (snap["version"] !== 1) return BLOCKED_RESTORE;

    // savedAt must be a number
    if (typeof snap["savedAt"] !== "number") return BLOCKED_RESTORE;

    // state must be a plain object with a phase string
    const state = snap["state"];
    if (!isPlainObject(state)) return BLOCKED_RESTORE;

    const s = state as Record<string, unknown>;
    if (typeof s["phase"] !== "string") return BLOCKED_RESTORE;
    if (!isPlainObject(s["display"])) return BLOCKED_RESTORE;

    // Structural validation passed — cast to CursorSessionState.
    // The session transition guards enforce invariants at runtime;
    // if the state is somehow inconsistent, the next operation will
    // produce a blocked or invalid-transition state safely.
    return state as CursorSessionState;
  } catch {
    return BLOCKED_RESTORE;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
