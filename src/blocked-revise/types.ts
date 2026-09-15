/**
 * Blocked-revise context — BER S2 / AI_SEAMS_V1_REV_2.
 *
 * Plan-level re-entry into the candidate-plan proposer after a Start/handoff
 * refuse. Output is a new candidate plan (SYSTEM SUGGESTS). Never executes.
 */

import type { BlockedExplainRefuseCode } from "../blocked-explain/types.js";

export type BlockedReviseContext = {
  readonly refuseCode: BlockedExplainRefuseCode;
  /** Original ratified goal (or best available plan summary). */
  readonly originalGoal: string;
  /** Operator guidance for the new candidate (required). */
  readonly revisionText: string;
  readonly workItemId: string;
  /** Deterministic V1 floor hash (CP-1); may be prior plan hash. */
  readonly baselinePlanHash: string;
  readonly memoryPointId?: string | null;
  readonly structuralFacts?: readonly string[];
  readonly planSummary?: string;
};

/** Bounds — INV-AI-5 / fail-closed. */
export const MAX_REVISION_TEXT_LENGTH = 2_000;
export const MAX_ORIGINAL_GOAL_LENGTH = 6_000;
export const MIN_REVISION_TEXT_LENGTH = 3;
