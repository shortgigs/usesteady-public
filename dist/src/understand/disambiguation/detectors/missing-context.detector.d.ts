/**
 * Missing-context ambiguity detector.
 *
 * Detects inputs that contain underspecified references like "the file",
 * "my project", "the config" without a concrete identifier.
 *
 * These inputs are ambiguous because it is not possible to determine
 * which specific artifact is being referenced.
 */
import type { AmbiguityDetector } from "../types.js";
export declare const missingContextDetector: AmbiguityDetector;
//# sourceMappingURL=missing-context.detector.d.ts.map