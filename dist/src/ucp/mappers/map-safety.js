/**
 * Mapper: SafetyResult → SafetyEnvelope.
 *
 * Maps exactly from SafetyResult (src/safety/types.ts).
 * Includes inspection fields (detectorId, matchedPattern) when present.
 * "allow" results carry only the verdict — no reason or note.
 *
 * Optional fields use conditional spreading — never explicit undefined.
 * See: src/ucp/types.ts — "PROTOCOL INVARIANT: Payloads must be undefined-free"
 */
import { createSafetyEnvelope } from "../envelope.js";
export function mapSafetyToEnvelope(result, refs) {
    const payload = {
        verdict: result.verdict,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(result.detectorId !== undefined ? { detectorId: result.detectorId } : {}),
        ...(result.matchedPattern !== undefined ? { matchedPattern: result.matchedPattern } : {}),
        ...(result.note !== undefined ? { note: result.note } : {}),
    };
    return createSafetyEnvelope(payload, refs);
}
//# sourceMappingURL=map-safety.js.map