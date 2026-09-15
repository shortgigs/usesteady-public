/**
 * Boundary Explanation — Phase 5C public API.
 *
 * Exports types and detection functions.
 * This module is presentation-layer only.
 * It has zero authority over routing, mode, or confirm decisions.
 */
export type { BoundaryExplanationCode, BoundaryExplanation } from "./boundary-explanation-types.js";
export { detectBoundaryExplanation, detectReminderBoundaryExplanation } from "./boundary-explanation-detector.js";
