/**
 * Mapper: IntentInterpretation → IntentInterpretationEnvelope.
 *
 * Maps exactly from IntentInterpretation
 * (src/understand/intent-interpretation/types.ts).
 * Returns null when no interpretation was produced (bridge stayed silent).
 */
import { createIntentInterpretationEnvelope } from "../envelope.js";
export function mapIntentInterpretationToEnvelope(interpretation, refs) {
    return createIntentInterpretationEnvelope({
        category: interpretation.category,
        summary: interpretation.summary,
        confidence: interpretation.confidence,
        basis: interpretation.basis,
    }, refs);
}
//# sourceMappingURL=map-intent-interpretation.js.map