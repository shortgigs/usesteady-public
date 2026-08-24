/**
 * Mapper: InterpretationResult → ChangeInterpretationEnvelope.
 *
 * Maps exactly from InterpretationResult
 * (src/understand/interpretation/types.ts).
 * Only produced when mode === "execute" and the input matched a structured
 * change pattern.
 */
import { createChangeInterpretationEnvelope } from "../envelope.js";
export function mapChangeInterpretationToEnvelope(result, refs) {
    return createChangeInterpretationEnvelope({
        summary: result.summary,
        impact: result.impact,
        confidence: result.confidence,
        category: result.category,
    }, refs);
}
//# sourceMappingURL=map-change-interpretation.js.map