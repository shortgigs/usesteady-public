/**
 * Cursor execution layer — public API.
 *
 * Exports the two-phase product seam coordinator and its display types.
 * Internal cursor module (src/cursor/) is re-exported separately via src/cursor/index.ts.
 *
 * Consumer entry points:
 *   prepareCursorExecution()   — Phase 1: build + OCD → artifact for H confirmation
 *   deliverCursorExecution()   — Phase 2: approved artifact + gate → file mutation
 *
 * Consumer helpers:
 *   hasConflicts()             — check if OCD fired (H must review before approving)
 *   isCursorExecutionAccepted() — check if edit was applied
 *   getCursorExecutionNote()   — plain-English note for display
 */

export type {
  CursorPreparationResult,
  CursorPreparationDisplay,
  CursorExecutionResult,
  CursorExecutionDisplay,
} from "./cursor-execution-coordinator.js";

export {
  prepareCursorExecution,
  deliverCursorExecution,
  hasConflicts,
  isCursorExecutionAccepted,
  getCursorExecutionNote,
} from "./cursor-execution-coordinator.js";

// Re-export ParsedChange so consumers of the cursor execution layer
// don't need to import from the internal interpretation module directly.
export type { ParsedChange } from "../../understand/interpretation/types.js";
export { parseChange }       from "../../understand/interpretation/parser.js";
