/**
 * Disambiguation detector registry.
 *
 * Detectors are sorted by priority ascending (lower number = runs first).
 */
import { typoAdjacentDetector } from "./detectors/typo-adjacent.detector.js";
import { overloadedTermDetector } from "./detectors/overloaded-term.detector.js";
import { missingContextDetector } from "./detectors/missing-context.detector.js";
const REGISTERED_DETECTORS = [
    typoAdjacentDetector,
    overloadedTermDetector,
    missingContextDetector,
].sort((a, b) => a.priority - b.priority);
export function getDisambiguationDetectors() {
    return REGISTERED_DETECTORS;
}
export function runDisambiguation(input) {
    for (const detector of getDisambiguationDetectors()) {
        if (detector.supports(input)) {
            const result = detector.detect(input);
            if (result !== null)
                return result;
        }
    }
    return { kind: "unknown" };
}
//# sourceMappingURL=registry.js.map