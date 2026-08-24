/**
 * Mapper: IntakeResult → ResponseEnvelope.
 *
 * Maps the final planner decision from IntakeResult (src/intake/types.ts).
 * This is always the last decision envelope in a UCP bundle.
 *
 * Optional fields (guidance) use conditional spreading — never explicit undefined.
 * See: src/ucp/types.ts — "PROTOCOL INVARIANT: Payloads must be undefined-free"
 */
import { createResponseEnvelope } from "../envelope.js";
export function mapResponseToEnvelope(result, refs) {
    const guidance = result.guidance !== undefined
        ? {
            missing: [...result.guidance.missing],
            nextSteps: result.guidance.nextSteps.map((s) => ({ type: s.type, label: s.label })),
        }
        : undefined;
    return createResponseEnvelope({
        mode: result.mode,
        reason: result.reason,
        intentState: result.intentState,
        ...(guidance !== undefined ? { guidance } : {}),
    }, refs);
}
//# sourceMappingURL=map-response.js.map