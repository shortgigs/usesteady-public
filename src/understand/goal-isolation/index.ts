/**
 * Goal isolation — public API (charter S1, consumed by nothing yet).
 *
 * Charter: docs/product/USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1.md
 */

export {
  INTENT_SEGMENT_CATEGORIES,
  type IntentSegmentCategory,
  type IntentSpan,
  type IsolatedIntent,
  type IsolatedIntentSegment,
  type IsolatedIntentSource,
  type IsolatedIntentProposedBy,
} from "./types.js";

export {
  proposeIsolatedIntent,
  proposeIsolatedIntentOutcome,
  type GoalIsolationOutcome,
  locateAndValidateSpans,
  MAX_ISOLATION_INPUT_LENGTH,
  MAX_ISOLATION_SPANS,
  MAX_GOAL_LENGTH,
  MAX_WHOLE_BLOB_GOAL_WORDS,
  MAX_COMPOUND_GOALS,
  type IsolationModelCall,
  type LocatedSpan,
} from "./proposer.js";
