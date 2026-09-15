/**
 * Disambiguation detector registry.
 *
 * Detectors are sorted by priority ascending (lower number = runs first).
 */

import type { AmbiguityDetector } from "./types.js";
import { typoAdjacentDetector } from "./detectors/typo-adjacent.detector.js";
import { overloadedTermDetector } from "./detectors/overloaded-term.detector.js";
import { missingContextDetector } from "./detectors/missing-context.detector.js";

const REGISTERED_DETECTORS: ReadonlyArray<AmbiguityDetector> = [
  typoAdjacentDetector,
  overloadedTermDetector,
  missingContextDetector,
].sort((a, b) => a.priority - b.priority);

export function getDisambiguationDetectors(): ReadonlyArray<AmbiguityDetector> {
  return REGISTERED_DETECTORS;
}

/**
 * Run all disambiguation detectors in priority order.
 * Returns the first non-null result, or { kind: "unknown" } if none match.
 */
import type { DisambiguationResult } from "./types.js";

export function runDisambiguation(input: string): DisambiguationResult {
  for (const detector of getDisambiguationDetectors()) {
    if (detector.supports(input)) {
      const result = detector.detect(input);
      if (result !== null) return result;
    }
  }
  return { kind: "unknown" };
}
