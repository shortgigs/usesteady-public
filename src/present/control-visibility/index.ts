/**
 * Control Visibility & Boundary Integrity (CVG) — Phase 5B public API.
 *
 * Usage in presentation entry points:
 *
 *   import { evaluateControlVisibility, assertControlVisibilityConsistency }
 *     from "./control-visibility/index.js";
 *
 *   const cvg = evaluateControlVisibility({ kind: "reminder_presentation", presentation });
 *   assertControlVisibilityConsistency(cvg);
 *   // result is unchanged — CVG is a read-only hook
 */

export type {
  ControlSignalLevel,
  ControlSignal,
  ControlVisibilityResult,
  ControlVisibilityInput,
} from "./control-visibility-types.js";

export { evaluateControlVisibility } from "./control-visibility-evaluator.js";

export {
  assertControlVisibilityConsistency,
  ControlVisibilityViolationError,
} from "./control-visibility-assertions.js";
