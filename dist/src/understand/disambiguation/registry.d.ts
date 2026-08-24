/**
 * Disambiguation detector registry.
 *
 * Detectors are sorted by priority ascending (lower number = runs first).
 */
import type { AmbiguityDetector } from "./types.js";
export declare function getDisambiguationDetectors(): ReadonlyArray<AmbiguityDetector>;
/**
 * Run all disambiguation detectors in priority order.
 * Returns the first non-null result, or { kind: "unknown" } if none match.
 */
import type { DisambiguationResult } from "./types.js";
export declare function runDisambiguation(input: string): DisambiguationResult;
//# sourceMappingURL=registry.d.ts.map