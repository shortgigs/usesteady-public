/**
 * Mapper: DebugTrace → DebugTraceEnvelope.
 *
 * Maps exactly from DebugTrace (src/intake/trace.ts).
 * Zero-authority: this envelope records what happened; it changes nothing.
 */
import type { DebugTraceEnvelope, UCPRefs } from "../types.js";
import type { DebugTrace } from "../../intake/trace.js";
export declare function mapDebugTraceToEnvelope(trace: DebugTrace, refs?: UCPRefs): DebugTraceEnvelope;
//# sourceMappingURL=map-debug-trace.d.ts.map