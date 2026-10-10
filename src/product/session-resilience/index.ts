/**
 * Session Resilience — Phase 6C public API.
 *
 * Exports snapshot/restore, staleness annotation, and terminal session summary.
 *
 * Authority model (unchanged):
 *   - serializeSession / restoreSession: persistence only, no re-evaluation
 *   - evaluateSessionStaleness: annotation only, no routing authority
 *   - summarizeSession: terminal audit only, no authority
 */

// Snapshot types
export type { CursorSessionSnapshot }    from "./session-snapshot-types.js";

// Serialization
export { serializeSession, restoreSession } from "./session-serializer.js";

// Staleness
export type { SessionStaleness }            from "./session-staleness.js";
export { evaluateSessionStaleness }         from "./session-staleness.js";

// Summary
export type { SessionSummary }              from "./session-summary.js";
export { summarizeSession }                 from "./session-summary.js";
