/**
 * Production replay execution — public exports (record-only).
 */

export { REPLAY_EXECUTION_VERSION } from "./constants.js";
export {
  executeReplaySandboxCandidate,
  replayExecutionOutcomeFingerprint,
} from "./execute.js";
export { replayExecutionId } from "./replay-id.js";
export type {
  ExecuteReplaySandboxCandidateInput,
  ReplayExecutionLineageEntry,
  ReplayExecutionLineageKind,
  ReplayExecutionRecord,
  ReplayExecutionState,
} from "./types.js";
export { ReplayExecutionRejectedError } from "./types.js";

export {
  evaluateReplayExecutionEligibility,
  isReplayExecutionEligibilityExpired,
  REPLAY_EXECUTION_ELIGIBILITY_TTL_MS,
} from "./eligibility/index.js";
export type {
  ReplayExecutionEligibilityRecord,
  ReplayExecutionEligibilityState,
} from "./eligibility/index.js";

export {
  appendReplayExecutionAuditEntry,
  deriveReplayExecutionAuditEntry,
  listReplayExecutionAuditEntries,
  resetReplayExecutionAuditStoreForTests,
  resolveOperatorIdFromWorkerResult,
  ReplayExecutionAuditRejectedError,
} from "./audit/index.js";
export type {
  ReplayExecutionAuditEntry,
  ReplayExecutionAuditState,
} from "./audit/index.js";
