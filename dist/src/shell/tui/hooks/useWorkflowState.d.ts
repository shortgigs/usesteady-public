/**
 * TUI v1 — useWorkflowState hook.
 *
 * Polls the PID-scoped temp file every 200ms and returns the latest
 * WorkflowState. Falls back to the empty default state when the file
 * is absent or unparseable.
 */
import type { WorkflowState } from "../types.js";
export declare function useWorkflowState(): WorkflowState;
//# sourceMappingURL=useWorkflowState.d.ts.map