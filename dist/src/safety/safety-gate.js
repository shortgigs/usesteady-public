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
import { getSafetyDetectors } from "./registry.js";
import { canonicalizeForSafety, CanonicalizationError, } from "./canonicalize.js";
export function runSafetyGate(input) {
    let canonical;
    try {
        canonical = canonicalizeForSafety(input);
    }
    catch (err) {
        const detail = err instanceof CanonicalizationError ? err.message : "unknown error";
        return {
            verdict: "block",
            reason: "evasion_or_rule_bypass",
            detectorId: "input_canonicalization",
            matchedPattern: "canonicalization_failure",
            note: `Input could not be canonicalized; blocked fail-closed (${detail}).`,
        };
    }
    for (const detector of getSafetyDetectors()) {
        if (detector.supports(canonical)) {
            const result = detector.detect(canonical);
            if (result !== null && result.verdict === "block") {
                return { ...result, detectorId: detector.id };
            }
        }
    }
    return { verdict: "allow" };
}
//# sourceMappingURL=safety-gate.js.map