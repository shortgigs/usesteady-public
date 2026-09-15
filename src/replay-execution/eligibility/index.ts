/**
 * Replay execution eligibility — public exports (pure gate only).
 */

export { REPLAY_EXECUTION_ELIGIBILITY_TTL_MS } from "./constants.js";
export {
  evaluateReplayExecutionEligibility,
  replayExecutionEligibilityOutcomeFingerprint,
} from "./evaluate.js";
export { isReplayExecutionEligibilityExpired } from "./expire.js";
export { replayExecutionEligibilityRecordId } from "./record-id.js";
export type {
  EvaluateReplayExecutionEligibilityInput,
  ReplayExecutionEligibilityLineageEntry,
  ReplayExecutionEligibilityRecord,
  ReplayExecutionEligibilityState,
} from "./types.js";
