/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - guarded report orchestrator.
 *
 * `reportRunToPortal` is the single entry point the run-completion seam calls. It
 * resolves opt-in (default off), builds the payload, and sends it - all guarded
 * so it NEVER throws. A disabled opt-in or any failure returns a structured
 * outcome; it never affects the caller's run.
 *
 * Feature 2.2: WorkflowTask outcomes are executor/delivery self-reports, not
 * human decisions. `deliveryReportSummaryFromOutcomes` is the truthful mapper
 * for those classes. `decisionSummaryFromOutcomes` is retired as a
 * decision-truth mapper and fail-closes to zero / not_available.
 */
import { type ExecutionReturnInput } from "./build-payload.js";
import { type PortalReportingDisabledReason } from "./opt-in.js";
import { type SendResult } from "./transport.js";
import type { ExecutionReturnDecisionSummary, ExecutionReturnDeliveryReportSummary, ExecutionReturnOutcomeVerification } from "./types.js";
import type { OutcomeVerification } from "../../workflow/outcome-verification.js";
/**
 * P6 V1 — pick the run-level outcome verification from per-task records.
 * Disagreement wins. `accepted` is never consulted.
 */
export declare function outcomeVerificationFromTasks(verifications: readonly (OutcomeVerification | undefined)[]): ExecutionReturnOutcomeVerification | undefined;
export type ReportOutcome = {
    readonly reported: true;
    readonly result: SendResult;
} | {
    readonly reported: false;
    readonly reason: PortalReportingDisabledReason | string;
};
/**
 * Fail-closed decision summary when the construction path has no explicit
 * per-item human-decision evidence. `executed: 0` / `not_established` means
 * execution is not established by this field — not that nothing executed.
 */
export declare function unavailableDecisionSummary(totalSteps: number, breakGlass: boolean): ExecutionReturnDecisionSummary;
/**
 * Format an already-present ratification decision. Does not look up, infer,
 * or verify authority — the caller must already hold `decision`.
 * `executed: 0` / `not_established` is unknown-by-this-field, not non-execution.
 */
export declare function decisionSummaryFromExplicitRatification(decision: "approved" | "rejected", breakGlass: boolean): ExecutionReturnDecisionSummary;
/**
 * Pure: CLI / executor outcome strings -> delivery self-report counts.
 * `accepted` increments only this summary.
 */
export declare function deliveryReportSummaryFromOutcomes(outcomes: readonly string[]): ExecutionReturnDeliveryReportSummary;
/**
 * Retired as a decision-truth mapper (G1-F5). WorkflowTask outcomes are
 * executor/delivery self-reports, not human decisions. Returns fail-closed
 * zeros: approved/rejected `not_available`, executed `not_established`
 * (unknown-by-this-field, not proof of non-execution).
 */
export declare function decisionSummaryFromOutcomes(outcomes: readonly string[], breakGlass: boolean): ExecutionReturnDecisionSummary;
export declare function reportRunToPortal(input: {
    readonly buildInput: ExecutionReturnInput;
    readonly flag: boolean;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
}): Promise<ReportOutcome>;
//# sourceMappingURL=report-run.d.ts.map