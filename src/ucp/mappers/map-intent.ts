/**
 * Mapper: raw input string → IntentEnvelope.
 *
 * The intent envelope captures the user's raw input before any processing.
 * It is always the first envelope in a UCP bundle.
 */

import { createIntentEnvelope } from "../envelope.js";
import type { IntentEnvelope, UCPRefs } from "../types.js";

export function mapIntentToEnvelope(input: string, refs?: UCPRefs): IntentEnvelope {
  return createIntentEnvelope({ input }, refs);
}
