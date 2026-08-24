/**
 * Typo-adjacent ambiguity detector.
 *
 * Detects inputs where a word closely resembles another word with a
 * significantly different meaning in a UseSteady context.
 *
 * This is NOT a generic spellchecker. Only well-known, high-risk pairs
 * are registered. The pair must change the semantic meaning materially.
 *
 * Example pair: "loops" vs "loopholes"
 *   "fix the loops in the code" → code loop (clear programming construct)
 *   "loops" near "approval"/"rule" → might mean loopholes (policy bypass)
 */
import type { AmbiguityDetector } from "../types.js";
export declare const typoAdjacentDetector: AmbiguityDetector;
//# sourceMappingURL=typo-adjacent.detector.d.ts.map