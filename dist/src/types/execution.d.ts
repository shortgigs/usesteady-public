/**
 * Phase 1 — Execution Control Core
 *
 * Canonical type for a single execution step shown to the user for approval.
 * This is the server-side source of truth. The UI mirrors this shape in
 * ui/src/api/types.ts (same pattern as WorkflowRun / WorkflowTask mirrors).
 */
export type ExecutionStep = {
    id: string;
    file_path: string;
    action_type: "create" | "update" | "delete" | "rename";
    system_will: {
        summary: string;
        changes: {
            file: string;
            details: string;
        }[];
        impact: string[];
        risk_notes: string[];
    };
    risk_level: "low" | "medium" | "high";
    why_explanation: string;
    status: "pending" | "approved" | "rejected";
};
//# sourceMappingURL=execution.d.ts.map