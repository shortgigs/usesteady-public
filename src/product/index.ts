/**
 * Product layer — public API.
 *
 * CursorProductSession and ClaudeProductSession are the entry points for
 * connecting the execution engine to user interaction flows (CLI, UI, plugin).
 *
 * Cursor consumer pattern:
 *   let session = createSession();
 *   session = submit(session, input, policy);
 *   session = approve(session);
 *   session = await deliver(session, plugin, storeDir);
 *
 * Claude consumer pattern:
 *   let session = createClaudeSession();
 *   session = submitClaude(session, input, policy, toolPolicy);
 *   session = approveClaude(session);
 *   session = await deliverClaude(session, plugin, storeDir);
 */

export type {
  SessionPhase,
  CursorSessionState,
  SessionDisplay,
} from "./cursor-product-session.js";

export {
  createSession,
  submit,
  approve,
  acceptConflict,
  narrow,
  answerScope,
  reject,
  deliver,
  isTerminal,
  isAccepted,
  getPresentHints,
} from "./cursor-product-session.js";

// Phase 5D: contradiction visibility wiring
export type { CursorPresentHints } from "../execution/cursor/cursor-execution-coordinator.js";

// ─── Phase 8C: Claude Product Session (see docs/claude-v1-baseline.md) ──────

export type {
  ClaudeSessionPhase,
  ClaudeSessionState,
  ClaudeSessionDisplay,
} from "./claude-product-session.js";

export {
  createClaudeSession,
  submitClaude,
  approveClaude,
  acceptClaudeConflict,
  narrowClaude,
  answerClaudeScope,
  rejectClaude,
  deliverClaude,
  isClaudeTerminal,
  isClaudeAccepted,
} from "./claude-product-session.js";

// ─── Phase 6C: Session Resilience ────────────────────────────────────────────

export type { CursorSessionSnapshot } from "./session-resilience/index.js";
export type { SessionStaleness }      from "./session-resilience/index.js";
export type { SessionSummary }        from "./session-resilience/index.js";

export {
  serializeSession,
  restoreSession,
  evaluateSessionStaleness,
  summarizeSession,
} from "./session-resilience/index.js";
