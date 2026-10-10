/**
 * Public surface of the SessionController module (M5).
 *
 * Per design `docs/SESSION_CONTROLLER_DESIGN.md` the controller is the
 * single owner of `process.stdin` for the process lifetime. Everything
 * else that needs input asks through `requestInput()`.
 *
 * Exports are intentionally narrow. Commit 1 of §13 ships the state-
 * machine + class skeleton; subsequent commits migrate call-sites.
 */

export {
  type SessionState,
  type SessionMode,
  type SessionConfig,
  type SessionEvent,
  type InputPurpose,
  type TransitionResult,
  ALL_SESSION_STATES,
  transition,
  SessionController,
} from "./controller.js";
