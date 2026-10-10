/**
 * Candidate Plan layer (USESTEADY_CANDIDATE_PLAN_CONTRACT_V2, CP.S1).
 *
 * NOT exported from src/index.ts and NOT imported by any surface until
 * CP.S3 — CP-5 (removal invariant): with no adapter configured, every
 * UseSteady surface behaves byte-identically to before this layer existed.
 */

export type {
  CandidateExecutorClass,
  CandidatePlanOutcome,
  CandidatePlanRequest,
  CandidatePlanTask,
  CandidatePlanV2,
  CandidateTaskViolation,
  RawCandidateTask,
} from "./types.js";
export { CANDIDATE_EXECUTOR_CLASSES } from "./types.js";
export type { CandidatePlanAdapter } from "./adapter.js";
export { StubCandidatePlanAdapter } from "./adapter.js";
export { generateCandidatePlan } from "./gate.js";
export type { CandidatePlanModelCall } from "./model-adapter.js";
export {
  CANDIDATE_PLAN_SYSTEM_PROMPT,
  MAX_PLAN_INPUT_LENGTH,
  MAX_PLAN_TASKS,
  MAX_TASK_FIELD_LENGTH,
  ModelCandidatePlanAdapter,
} from "./model-adapter.js";
export type {
  CandidatePlanEvidenceEvent,
  CandidatePlanEvidenceLine,
  CandidatePlanEvidenceOutcome,
  CandidatePlanEvidenceSink,
} from "./evidence.js";
export {
  fileCandidatePlanEvidenceSink,
  readCandidatePlanEvidence,
} from "./evidence.js";
