/**
 * Mapper: CompletionResult → CompletionEnvelope.
 *
 * Maps exactly from CompletionResult (src/understand/completion/types.ts).
 * Covers all three completion kinds: complete, incomplete, guided_recovery.
 */

import { createCompletionEnvelope } from "../envelope.js";
import type { CompletionEnvelope, CompletionPayload, UCPRefs } from "../types.js";
import type { CompletionResult } from "../../understand/completion/types.js";

export function mapCompletionToEnvelope(
  result: CompletionResult,
  refs?: UCPRefs,
): CompletionEnvelope {
  let payload: CompletionPayload;

  if (result.kind === "complete") {
    payload = { kind: "complete" };
  } else {
    // incomplete or guided_recovery — both carry reason, missing, nextSteps
    payload = {
      kind:      result.kind,
      reason:    result.reason,
      missing:   result.missing,
      nextSteps: result.nextSteps,
    };
  }

  return createCompletionEnvelope(payload, refs);
}
