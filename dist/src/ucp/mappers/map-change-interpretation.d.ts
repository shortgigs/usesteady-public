/**
 * Mapper: InterpretationResult → ChangeInterpretationEnvelope.
 *
 * Maps exactly from InterpretationResult
 * (src/understand/interpretation/types.ts).
 * Only produced when mode === "execute" and the input matched a structured
 * change pattern.
 */
import type { ChangeInterpretationEnvelope, UCPRefs } from "../types.js";
import type { InterpretationResult } from "../../understand/interpretation/types.js";
export declare function mapChangeInterpretationToEnvelope(result: InterpretationResult, refs?: UCPRefs): ChangeInterpretationEnvelope;
//# sourceMappingURL=map-change-interpretation.d.ts.map