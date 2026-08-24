/**
 * Mapper: PRVResult → PRVEnvelope.
 *
 * Maps exactly from PRVResult (src/prv/types.ts).
 * No interpretation of values — fields are transferred as-is.
 */
import type { PRVEnvelope, UCPRefs } from "../types.js";
import type { PRVResult } from "../../prv/types.js";
export declare function mapPRVToEnvelope(result: PRVResult, refs?: UCPRefs): PRVEnvelope;
//# sourceMappingURL=map-prv.d.ts.map