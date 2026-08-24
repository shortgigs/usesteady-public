/**
 * Mapper: raw input string → IntentEnvelope.
 *
 * The intent envelope captures the user's raw input before any processing.
 * It is always the first envelope in a UCP bundle.
 */
import { createIntentEnvelope } from "../envelope.js";
export function mapIntentToEnvelope(input, refs) {
    return createIntentEnvelope({ input }, refs);
}
//# sourceMappingURL=map-intent.js.map