/**
 * Mapper: raw input string → IntentEnvelope.
 *
 * The intent envelope captures the user's raw input before any processing.
 * It is always the first envelope in a UCP bundle.
 */
import type { IntentEnvelope, UCPRefs } from "../types.js";
export declare function mapIntentToEnvelope(input: string, refs?: UCPRefs): IntentEnvelope;
//# sourceMappingURL=map-intent.d.ts.map