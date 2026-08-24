/**
 * src/friction/auto-capture.ts
 *
 * Automatic friction event capture hooks for the server layer.
 *
 * These functions are the only integration points between the core
 * workflow domain and the friction pipeline. They must be:
 *  - Synchronous (no awaiting — never block the HTTP response path)
 *  - Zero-authority (read-only access to run state)
 *  - Silent on failure (errors logged to stderr, never rethrown)
 *
 * Called from server.ts after state-mutating actions.
 */
import type { FrictionContext } from "./types.js";
import type { WorkflowRun } from "../workflow/types.js";
/**
 * Call this after every workflow run that has reached a terminal phase
 * (task_failed, stopped, skipped_by_intake).
 *
 * Enqueues a "workflow-failure" friction event and schedules a flush.
 * Never throws — any error is written to stderr and silently dropped.
 */
export declare function captureWorkflowFailure(run: WorkflowRun, workspaceRoot: string): void;
/**
 * Call this from an Express error middleware to capture server-side errors.
 * The middleware should be registered AFTER all routes in server.ts.
 */
export declare function captureServerError(err: Error, route: string): void;
/**
 * Enqueue a user-initiated friction report (from UI or CLI).
 * Called with pre-built context from the UI report modal or `usesteady report`.
 */
export declare function captureManualReport(opts: {
    kind: "ux-block" | "manual-cli" | "install-error";
    notes: string;
    context?: Partial<FrictionContext>;
}): string;
//# sourceMappingURL=auto-capture.d.ts.map