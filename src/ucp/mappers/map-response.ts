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
import type { ResponseEnvelope, UCPRefs } from "../types.js";
import type { IntakeResult } from "../../intake/types.js";

export function mapResponseToEnvelope(result: IntakeResult, refs?: UCPRefs): ResponseEnvelope {
  const guidance = result.guidance !== undefined
    ? {
        missing:   [...result.guidance.missing],
        nextSteps: result.guidance.nextSteps.map((s) => ({ type: s.type, label: s.label })),
      }
    : undefined;

  return createResponseEnvelope(
    {
      mode:        result.mode,
      reason:      result.reason,
      intentState: result.intentState,
      ...(guidance !== undefined ? { guidance } : {}),
    },
    refs,
  );
}
