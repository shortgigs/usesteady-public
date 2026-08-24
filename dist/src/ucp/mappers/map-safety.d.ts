/**
 * Mapper: SafetyResult → SafetyEnvelope.
 *
 * Maps exactly from SafetyResult (src/safety/types.ts).
 * Includes inspection fields (detectorId, matchedPattern) when present.
 * "allow" results carry only the verdict — no reason or note.
 *
 * Optional fields use conditional spreading — never explicit undefined.
 * See: src/ucp/types.ts — "PROTOCOL INVARIANT: Payloads must be undefined-free"
 */
import type { SafetyEnvelope, UCPRefs } from "../types.js";
import type { SafetyResult } from "../../safety/types.js";
export declare function mapSafetyToEnvelope(result: SafetyResult, refs?: UCPRefs): SafetyEnvelope;
//# sourceMappingURL=map-safety.d.ts.map