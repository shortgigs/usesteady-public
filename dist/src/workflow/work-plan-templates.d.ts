/**
 * Intrinsic phase templates — USESTEADY_WORKPLAN_GENERATION_V1
 *
 * Closed, curated sets per deliverable type. No F1–F4 forbidden classes.
 */
import type { DeliverableType, WorkPlanOperatorAction } from "./work-plan-types.js";
export type PhaseTemplateEntry = {
    readonly id: string;
    readonly action: string;
    readonly targetKey: string;
    readonly outcomeKey: string;
    readonly operatorAction: WorkPlanOperatorAction;
};
export type PhaseTemplate = {
    readonly deliverableType: DeliverableType;
    readonly phases: readonly PhaseTemplateEntry[];
    readonly goalPattern: (subject: string, goalVerb?: string) => string;
    readonly terminalOutcomePattern: (subject: string) => string;
};
export declare const PHASE_TEMPLATES: Record<DeliverableType, PhaseTemplate>;
/** Forbidden-class action keywords (F1–F4) — must never appear in templates. */
export declare const FORBIDDEN_TEMPLATE_ACTIONS: readonly ["hire", "assign", "schedule", "estimate", "track", "monitor", "maintain", "dashboard", "database", "deploy"];
export declare function resolveTarget(targetKey: string, subject: string): string;
export declare function resolveOutcome(outcomeKey: string): string;
export declare function getTemplate(type: DeliverableType): PhaseTemplate;
//# sourceMappingURL=work-plan-templates.d.ts.map