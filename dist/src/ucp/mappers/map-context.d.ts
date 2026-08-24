/**
 * Mapper: ContextAlignmentResult → ContextAlignmentEnvelope.
 *
 * Maps exactly from ContextAlignmentResult (src/understand/context/types.ts).
 */
import type { ContextAlignmentEnvelope, UCPRefs } from "../types.js";
import type { ContextAlignmentResult } from "../../understand/context/types.js";
export declare function mapContextToEnvelope(result: ContextAlignmentResult, refs?: UCPRefs): ContextAlignmentEnvelope;
//# sourceMappingURL=map-context.d.ts.map