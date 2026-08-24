/**
 * Overloaded term detector.
 *
 * Detects inputs that contain terms with multiple well-known meanings
 * in a development/tooling context.
 *
 * Examples:
 *   "latest change"  → latest git commit? latest file modification? latest test run?
 *   "change button"  → change button text? change button color? change button behavior?
 */
import type { AmbiguityDetector } from "../types.js";
export declare const overloadedTermDetector: AmbiguityDetector;
//# sourceMappingURL=overloaded-term.detector.d.ts.map