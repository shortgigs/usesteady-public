/**
 * Mapper: DisambiguationResult → DisambiguationEnvelope.
 *
 * Maps exactly from DisambiguationResult (src/understand/disambiguation/types.ts).
 * The "unknown" kind carries no extra fields — the input simply had no signal.
 */
import type { DisambiguationEnvelope, UCPRefs } from "../types.js";
import type { DisambiguationResult } from "../../understand/disambiguation/types.js";
export declare function mapDisambiguationToEnvelope(result: DisambiguationResult, refs?: UCPRefs): DisambiguationEnvelope;
//# sourceMappingURL=map-disambiguation.d.ts.map