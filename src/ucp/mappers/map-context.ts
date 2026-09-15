/**
 * Mapper: ContextAlignmentResult → ContextAlignmentEnvelope.
 *
 * Maps exactly from ContextAlignmentResult (src/understand/context/types.ts).
 */

import { createContextAlignmentEnvelope } from "../envelope.js";
import type { ContextAlignmentEnvelope, ContextAlignmentPayload, UCPRefs } from "../types.js";
import type { ContextAlignmentResult } from "../../understand/context/types.js";

export function mapContextToEnvelope(
  result: ContextAlignmentResult,
  refs?: UCPRefs,
): ContextAlignmentEnvelope {
  const payload: ContextAlignmentPayload =
    result.kind === "hard_mismatch"
      ? { kind: result.kind, reason: result.reason }
      : { kind: result.kind };
  return createContextAlignmentEnvelope(payload, refs);
}
