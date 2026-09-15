/**
 * Default InteractionContract.
 *
 * Applied to any new subject that has no prior contract.
 * All modes start at balanced/plain_first/syntax_first.
 * All observedIntentPatterns counts start at zero.
 */

import type { InteractionContract, ObservedIntentPatterns } from "./types.js";

export const DEFAULT_OBSERVED_INTENT_PATTERNS: Readonly<ObservedIntentPatterns> = {
  visual_color:  0,
  text_change:   0,
  config_change: 0,
};

export const DEFAULT_CONTRACT: Readonly<InteractionContract> = {
  version:                  1,
  subjectId:                "anonymous",
  ambiguityMode:            "balanced",
  explanationMode:          "plain_first",
  unsupportedGuidanceMode:  "syntax_first",
  updatedAt:                "1970-01-01T00:00:00.000Z",
  source:                   "default",
  observedIntentPatterns:   DEFAULT_OBSERVED_INTENT_PATTERNS,
};

export function createDefaultContract(
  subjectId: string,
  createdAt: string = new Date().toISOString(),
): InteractionContract {
  return { ...DEFAULT_CONTRACT, subjectId, updatedAt: createdAt };
}
