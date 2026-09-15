/**
 * Session Snapshot Types — Phase 6C.
 *
 * Defines the versioned, serializable snapshot format for CursorSessionState.
 *
 * ── Design rules ──────────────────────────────────────────────────────────────
 *
 *   - Pure data only. No methods, no functions, no class instances.
 *   - No hidden references. Everything in a snapshot is a JSON-safe value.
 *   - No filesystem logic in this type layer.
 *   - Version field is required and checked on restore.
 *   - A mismatch in version → safe fallback (never crash).
 *
 * ── Authority constraint ──────────────────────────────────────────────────────
 *
 *   A snapshot carries session state for persistence only.
 *   Restoring a snapshot does NOT re-run intake, delivery, or any gate logic.
 *   Authority boundaries remain unchanged after restore.
 */

import type { CursorSessionState } from "../cursor-product-session.js";

/**
 * CursorSessionSnapshot — a versioned, point-in-time capture of session state.
 *
 *   version  — snapshot format version. Must be 1. Checked on restore.
 *   savedAt  — Unix timestamp (ms) when the snapshot was taken.
 *   state    — the full CursorSessionState at save time.
 *
 * Snapshots are opaque to consumers: pass to restoreSession(), inspect nothing.
 */
export type CursorSessionSnapshot = {
  readonly version: 1;
  readonly savedAt: number;
  readonly state:   CursorSessionState;
};
