/**
 * Mapper: IntentInterpretation → IntentInterpretationEnvelope.
 *
 * Maps exactly from IntentInterpretation
 * (src/understand/intent-interpretation/types.ts).
 * Returns null when no interpretation was produced (bridge stayed silent).
 */
import type { IntentInterpretationEnvelope, UCPRefs } from "../types.js";
import type { IntentInterpretation } from "../../understand/intent-interpretation/types.js";
export declare function mapIntentInterpretationToEnvelope(interpretation: IntentInterpretation, refs?: UCPRefs): IntentInterpretationEnvelope;
//# sourceMappingURL=map-intent-interpretation.d.ts.map