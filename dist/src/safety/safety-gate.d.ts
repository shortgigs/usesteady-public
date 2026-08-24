/**
 * Safety Gate — runs detectors in priority order, injects detectorId on block.
 *
 * Detectors report `matchedPattern` (the specific phrase that matched).
 * The gate adds `detectorId` from `detector.id` so callers can identify
 * which detector fired without inspecting the source.
 *
 * Inspectable fields on a block result:
 *   result.detectorId      — which detector fired
 *   result.matchedPattern  — which phrase triggered it
 *   result.reason          — enum category
 *   result.note            — plain-English explanation
 *
 * Pre-detector canonicalization:
 *   The input is canonicalized (NFKC + zero-width strip + bidi strip)
 *   before any detector runs. Detectors are unchanged; they receive the
 *   canonical form. Canonicalization failure is fail-closed: the gate
 *   returns a block result without invoking any detector.
 *   See: src/safety/canonicalize.ts
 */
import type { SafetyResult } from "./types.js";
export declare function runSafetyGate(input: string): SafetyResult;
//# sourceMappingURL=safety-gate.d.ts.map