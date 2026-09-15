/**
 * Mapper: PRVResult → PRVEnvelope.
 *
 * Maps exactly from PRVResult (src/prv/types.ts).
 * No interpretation of values — fields are transferred as-is.
 */

import { createPRVEnvelope } from "../envelope.js";
import type { PRVEnvelope, PRVPayload, UCPRefs } from "../types.js";
import type { PRVResult } from "../../prv/types.js";

export function mapPRVToEnvelope(result: PRVResult, refs?: UCPRefs): PRVEnvelope {
  const payload: PRVPayload = result.ok
    ? { ok: true }
    : { ok: false, mode: result.mode, reason: result.reason };
  return createPRVEnvelope(payload, refs);
}
