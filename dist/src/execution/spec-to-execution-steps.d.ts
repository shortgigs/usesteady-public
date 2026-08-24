/**
 * Converts WorkflowSpec tasks into ExecutionStep[] for SYSTEM WILL preview.
 * Shared by server.ts (execution review panel) and CLI `usesteady plan`.
 */
import type { ExecutionStep } from "../types/execution.js";
import type { WorkflowSpec } from "../workflow/types.js";
/** Derive execution-review steps from a workflow spec (read-only preview). */
export declare function specToExecutionSteps(spec: WorkflowSpec, workspaceRoot: string): ExecutionStep[];
//# sourceMappingURL=spec-to-execution-steps.d.ts.map