/**
 * Mapper: DebugTrace → DebugTraceEnvelope.
 *
 * Maps exactly from DebugTrace (src/intake/trace.ts).
 * Zero-authority: this envelope records what happened; it changes nothing.
 */

import { createDebugTraceEnvelope } from "../envelope.js";
import type { DebugTraceEnvelope, UCPRefs } from "../types.js";
import type { DebugTrace } from "../../intake/trace.js";

export function mapDebugTraceToEnvelope(
  trace: DebugTrace,
  refs?: UCPRefs,
): DebugTraceEnvelope {
  return createDebugTraceEnvelope(
    {
      prvPassed:      trace.prvPassed,
      safetyVerdict:  trace.safetyVerdict,
      contextKind:    trace.contextKind,
      disambigKind:   trace.disambigKind,
      completionKind: trace.completionKind,
      bridgeFired:    trace.bridgeFired,
    },
    refs,
  );
}
