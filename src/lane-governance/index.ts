/**
 * Lane governance — G1 (LANE_GOVERNANCE_BY_USESTEADY_V1).
 *
 * Public surface for the lane-charter record kind (Gate 1 artifact shape) and
 * the Gate 2 session pre-flight. Gate 3 (the scope probe at PR) is
 * DELIBERATELY not exported from here: scripts/lane-scope-probe.mjs is
 * self-contained and independent of this module (INV-LG-3).
 */

export {
  LANE_CHARTER_KIND,
  canonicalJson,
  charterContentSha256,
  charterReferenceString,
  validateLaneCharter,
  isValidPathRule,
  normalizeChangedPath,
  pathMatchesRule,
  evaluatePathsAgainstCharter,
  scopeForRepo,
} from "./charter.js";
export type {
  LaneCharter,
  LaneRepoScope,
  CharterRatificationEvidence,
  StoredLaneCharter,
  CharterValidation,
  PathEvaluation,
} from "./charter.js";

export { preflightLaneSession, charterAdmissionErrors } from "./preflight.js";
export type { LanePreflightInput, LanePreflightResult } from "./preflight.js";

export {
  CHARTER_ABSENT_PRE_G1,
  normalizeLaneId,
  laneTransitionMarker,
  mergeRef,
  eventAtRef,
  recordedContextRef,
  parseTransitionMarker,
  findLaneTransition,
  readLaneEligibility,
  resolveTransitionCitations,
  recordLaneTransition,
} from "./transitions.js";
export type {
  LaneTransitionType,
  RecordedContext,
  LaneEligibility,
  TransitionCitation,
  LaneTransitionSpec,
} from "./transitions.js";
