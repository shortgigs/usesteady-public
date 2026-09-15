/**
 * Compose the revise zest — human-authored content the gate will hash (CP-3).
 *
 * Refuse codes are NOT embedded here (they are advisory context for the model
 * only). The zest is original goal + operator revision.
 */

import {
  MAX_ORIGINAL_GOAL_LENGTH,
  MAX_REVISION_TEXT_LENGTH,
  MIN_REVISION_TEXT_LENGTH,
} from "./types.js";

export function buildReviseZest(
  originalGoal: string,
  revisionText: string,
): string | null {
  const goal = originalGoal.trim().slice(0, MAX_ORIGINAL_GOAL_LENGTH);
  const revision = revisionText.trim().slice(0, MAX_REVISION_TEXT_LENGTH);
  if (goal.length === 0) return null;
  if (revision.length < MIN_REVISION_TEXT_LENGTH) return null;
  return `${goal}\n\nRevision: ${revision}`;
}
