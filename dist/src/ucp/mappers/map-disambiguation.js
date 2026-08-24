/**
 * Mapper: DisambiguationResult → DisambiguationEnvelope.
 *
 * Maps exactly from DisambiguationResult (src/understand/disambiguation/types.ts).
 * The "unknown" kind carries no extra fields — the input simply had no signal.
 */
import { createDisambiguationEnvelope } from "../envelope.js";
export function mapDisambiguationToEnvelope(result, refs) {
    let payload;
    if (result.kind === "clear") {
        payload = { kind: "clear", normalized: result.normalized };
    }
    else if (result.kind === "ambiguous") {
        payload = { kind: "ambiguous", reason: result.reason, options: result.options };
    }
    else {
        payload = { kind: "unknown" };
    }
    return createDisambiguationEnvelope(payload, refs);
}
//# sourceMappingURL=map-disambiguation.js.map