/**
 * Mapper: InterpretationResult → ChangeInterpretationEnvelope.
 *
 * Maps exactly from InterpretationResult
 * (src/understand/interpretation/types.ts).
 * Only produced when mode === "execute" and the input matched a structured
 * change pattern.
 */

import { createChangeInterpretationEnvelope } from "../envelope.js";
import type { ChangeInterpretationEnvelope, UCPRefs } from "../types.js";
import type { InterpretationResult } from "../../understand/interpretation/types.js";

export function mapChangeInterpretationToEnvelope(
  result: InterpretationResult,
  refs?: UCPRefs,
): ChangeInterpretationEnvelope {
  return createChangeInterpretationEnvelope(
    {
      summary:    result.summary,
      impact:     result.impact,
      confidence: result.confidence,
      category:   result.category,
    },
    refs,
  );
}
