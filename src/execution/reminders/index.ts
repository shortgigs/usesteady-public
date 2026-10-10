/**
 * Reminder Execution — Phase 6, Execution Layer.
 * Barrel export.
 */

export type {
  ReminderExecutionRequest,
  ParsedTime,
  ExecutionRejectionCode,
  ExecutionValidation,
  ReminderExecutionArtifact,
  ReminderExecutionResult,
} from "./reminder-execution-types.js";

export { parseTimeText }            from "./reminder-time-parser.js";
export { validateExecutionRequest } from "./reminder-execution-validator.js";
export { buildExecutionRequest, executeReminder } from "./reminder-executor.js";

// ── Integration coordinator (Phase 6 integration path) ────────────────────────
export type {
  ReminderExecutionDisplay,
  ReminderExecuteResult,
} from "./reminder-execution-coordinator.js";
export {
  executeFromPresent,
  isExecutionAccepted,
  getExecutionNote,
} from "./reminder-execution-coordinator.js";
