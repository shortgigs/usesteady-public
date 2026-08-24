/**
 * Mapper: IntakeResult → ResponseEnvelope.
 *
 * Maps the final planner decision from IntakeResult (src/intake/types.ts).
 * This is always the last decision envelope in a UCP bundle.
 *
 * Optional fields (guidance) use conditional spreading — never explicit undefined.
 * See: src/ucp/types.ts — "PROTOCOL INVARIANT: Payloads must be undefined-free"
 */
import type { ResponseEnvelope, UCPRefs } from "../types.js";
import type { IntakeResult } from "../../intake/types.js";
export declare function mapResponseToEnvelope(result: IntakeResult, refs?: UCPRefs): ResponseEnvelope;
//# sourceMappingURL=map-response.d.ts.map