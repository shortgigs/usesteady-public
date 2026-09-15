/**
 * Mapper: DisambiguationResult → DisambiguationEnvelope.
 *
 * Maps exactly from DisambiguationResult (src/understand/disambiguation/types.ts).
 * The "unknown" kind carries no extra fields — the input simply had no signal.
 */

import { createDisambiguationEnvelope } from "../envelope.js";
import type { DisambiguationEnvelope, DisambiguationPayload, UCPRefs } from "../types.js";
import type { DisambiguationResult } from "../../understand/disambiguation/types.js";

export function mapDisambiguationToEnvelope(
  result: DisambiguationResult,
  refs?: UCPRefs,
): DisambiguationEnvelope {
  let payload: DisambiguationPayload;

  if (result.kind === "clear") {
    payload = { kind: "clear", normalized: result.normalized };
  } else if (result.kind === "ambiguous") {
    payload = { kind: "ambiguous", reason: result.reason, options: result.options };
  } else {
    payload = { kind: "unknown" };
  }

  return createDisambiguationEnvelope(payload, refs);
}
