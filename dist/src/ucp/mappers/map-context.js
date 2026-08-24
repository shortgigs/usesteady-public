/**
 * Mapper: ContextAlignmentResult → ContextAlignmentEnvelope.
 *
 * Maps exactly from ContextAlignmentResult (src/understand/context/types.ts).
 */
import { createContextAlignmentEnvelope } from "../envelope.js";
export function mapContextToEnvelope(result, refs) {
    const payload = result.kind === "hard_mismatch"
        ? { kind: result.kind, reason: result.reason }
        : { kind: result.kind };
    return createContextAlignmentEnvelope(payload, refs);
}
//# sourceMappingURL=map-context.js.map