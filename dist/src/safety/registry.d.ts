/**
 * Safety detector registry.
 *
 * Detectors are sorted by priority ascending (lower number = runs first).
 * The gate iterates in priority order and returns the first blocking match.
 */
import type { SafetyDetector } from "./types.js";
export declare function getSafetyDetectors(): ReadonlyArray<SafetyDetector>;
//# sourceMappingURL=registry.d.ts.map