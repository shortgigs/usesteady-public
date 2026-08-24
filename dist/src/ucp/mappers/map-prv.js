/**
 * Mapper: PRVResult → PRVEnvelope.
 *
 * Maps exactly from PRVResult (src/prv/types.ts).
 * No interpretation of values — fields are transferred as-is.
 */
import { createPRVEnvelope } from "../envelope.js";
export function mapPRVToEnvelope(result, refs) {
    const payload = result.ok
        ? { ok: true }
        : { ok: false, mode: result.mode, reason: result.reason };
    return createPRVEnvelope(payload, refs);
}
//# sourceMappingURL=map-prv.js.map