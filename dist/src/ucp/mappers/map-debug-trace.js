/**
 * Mapper: DebugTrace → DebugTraceEnvelope.
 *
 * Maps exactly from DebugTrace (src/intake/trace.ts).
 * Zero-authority: this envelope records what happened; it changes nothing.
 */
import { createDebugTraceEnvelope } from "../envelope.js";
export function mapDebugTraceToEnvelope(trace, refs) {
    return createDebugTraceEnvelope({
        prvPassed: trace.prvPassed,
        safetyVerdict: trace.safetyVerdict,
        contextKind: trace.contextKind,
        disambigKind: trace.disambigKind,
        completionKind: trace.completionKind,
        bridgeFired: trace.bridgeFired,
    }, refs);
}
//# sourceMappingURL=map-debug-trace.js.map