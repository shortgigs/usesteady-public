/**
 * Mapper: IntentInterpretation → IntentInterpretationEnvelope.
 *
 * Maps exactly from IntentInterpretation
 * (src/understand/intent-interpretation/types.ts).
 * Returns null when no interpretation was produced (bridge stayed silent).
 */

import { createIntentInterpretationEnvelope } from "../envelope.js";
import type { IntentInterpretationEnvelope, UCPRefs } from "../types.js";
import type { IntentInterpretation } from "../../understand/intent-interpretation/types.js";

export function mapIntentInterpretationToEnvelope(
  interpretation: IntentInterpretation,
  refs?: UCPRefs,
): IntentInterpretationEnvelope {
  return createIntentInterpretationEnvelope(
    {
      category:   interpretation.category,
      summary:    interpretation.summary,
      confidence: interpretation.confidence,
      basis:      interpretation.basis,
    },
    refs,
  );
}
