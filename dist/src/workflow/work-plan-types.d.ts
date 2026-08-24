/**
 * WorkPlan types — USESTEADY_WORKPLAN_GENERATION_V1
 *
 * Pre-execution review artifact. No execution authority.
 * No children field — depth limit enforced structurally (Q3).
 */
export type WorkPlanOperatorAction = "approve" | "provide_input" | "decide";
export type WorkPlanTaskStatus = "pending" | "active" | "done";
export type WorkPlanEvidenceLevel = "explicit" | "derived";
export type WorkPlanSourceRef = {
    readonly ref: "rawInput" | `bullet:${number}`;
    readonly start: number;
    readonly end: number;
};
export type WorkPlanTask = {
    readonly id: string;
    readonly action: string;
    readonly target: string;
    readonly outcome: string;
    readonly operatorAction: WorkPlanOperatorAction;
    readonly sourceSpan: WorkPlanSourceRef;
    readonly status: WorkPlanTaskStatus;
    readonly evidenceLevel: WorkPlanEvidenceLevel;
    readonly precondition?: string;
};
export type WorkPlanTrustClass = "pre_execution_review";
export type WorkPlan = {
    readonly goal: string;
    readonly sourceContractRef: "rawInput";
    readonly tasks: readonly WorkPlanTask[];
    readonly nextAction: string;
    readonly terminalOutcome: string;
    readonly trustClass: WorkPlanTrustClass;
    readonly deliverableType: string;
    readonly planHash: string;
};
export type DeliverableType = "characterization" | "research_initiative" | "program_migration" | "capability_setup" | "refactor_scope" | "structure_scaffold" | "planning"
/** USESTEADY_ANALYSIS_SURFACE_IMPL_V1 — ratified S2: Analysis = specialized WorkPlan. */
 | "analysis_findings";
//# sourceMappingURL=work-plan-types.d.ts.map