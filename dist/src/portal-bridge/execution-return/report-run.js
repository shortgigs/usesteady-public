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
import { buildExecutionReturnPayload } from "./build-payload.js";
import { resolvePortalReporting } from "./opt-in.js";
import { sendExecutionReturn } from "./transport.js";
/**
 * P6 V1 — pick the run-level outcome verification from per-task records.
 * Disagreement wins. `accepted` is never consulted.
 */
export function outcomeVerificationFromTasks(verifications) {
    const present = verifications.filter((v) => v !== undefined);
    if (present.length === 0)
        return undefined;
    const chosen = present.find((v) => v.status === "disagreement") ??
        present.find((v) => v.status === "unknown") ??
        present.find((v) => v.status === "verified") ??
        present[present.length - 1];
    return {
        status: chosen.status,
        executor_report: chosen.executorReport,
        observation: chosen.observation,
        ...(chosen.realityVerdict !== undefined ? { reality_verdict: chosen.realityVerdict } : {}),
        ...(chosen.intendedVsActual !== undefined
            ? { intended_vs_actual: chosen.intendedVsActual }
            : {}),
    };
}
/**
 * Fail-closed decision summary when the construction path has no explicit
 * per-item human-decision evidence. `executed: 0` / `not_established` means
 * execution is not established by this field — not that nothing executed.
 */
export function unavailableDecisionSummary(totalSteps, breakGlass) {
    return {
        total_steps: totalSteps,
        approved: 0,
        rejected: 0,
        executed: 0,
        skipped: 0,
        break_glass: breakGlass,
        approved_basis: "not_available",
        rejected_basis: "not_available",
        executed_basis: "not_established",
        skipped_basis: "not_available",
    };
}
/**
 * Format an already-present ratification decision. Does not look up, infer,
 * or verify authority — the caller must already hold `decision`.
 * `executed: 0` / `not_established` is unknown-by-this-field, not non-execution.
 */
export function decisionSummaryFromExplicitRatification(decision, breakGlass) {
    return {
        total_steps: 1,
        approved: decision === "approved" ? 1 : 0,
        rejected: decision === "rejected" ? 1 : 0,
        executed: 0,
        skipped: 0,
        break_glass: breakGlass,
        approved_basis: "explicit_human_decision",
        rejected_basis: "explicit_human_decision",
        executed_basis: "not_established",
        skipped_basis: "not_available",
    };
}
/**
 * Pure: CLI / executor outcome strings -> delivery self-report counts.
 * `accepted` increments only this summary.
 */
export function deliveryReportSummaryFromOutcomes(outcomes) {
    let accepted = 0;
    let rejected = 0;
    let skipped = 0;
    let pending = 0;
    let stopped = 0;
    let other = 0;
    for (const o of outcomes) {
        if (o === "accepted")
            accepted += 1;
        else if (o === "rejected")
            rejected += 1;
        else if (o === "skipped" || o === "skipped_by_intake")
            skipped += 1;
        else if (o === "pending")
            pending += 1;
        else if (o === "stopped")
            stopped += 1;
        else
            other += 1;
    }
    return {
        basis: "executor_delivery_report",
        total: outcomes.length,
        accepted,
        rejected,
        skipped,
        pending,
        stopped,
        other,
    };
}
/**
 * Retired as a decision-truth mapper (G1-F5). WorkflowTask outcomes are
 * executor/delivery self-reports, not human decisions. Returns fail-closed
 * zeros: approved/rejected `not_available`, executed `not_established`
 * (unknown-by-this-field, not proof of non-execution).
 */
export function decisionSummaryFromOutcomes(outcomes, breakGlass) {
    return unavailableDecisionSummary(outcomes.length, breakGlass);
}
export async function reportRunToPortal(input) {
    try {
        const cfg = resolvePortalReporting({
            flag: input.flag,
            ...(input.env ? { env: input.env } : {}),
        });
        if (!cfg.enabled)
            return { reported: false, reason: cfg.reason };
        const payload = buildExecutionReturnPayload(input.buildInput);
        const result = await sendExecutionReturn(payload, {
            url: cfg.url,
            token: cfg.token,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        });
        if (!result.ok)
            return { reported: false, reason: result.reason };
        return { reported: true, result };
    }
    catch (err) {
        // Best-effort: a reporting failure must never surface to the run.
        return { reported: false, reason: err instanceof Error ? err.message : String(err) };
    }
}
//# sourceMappingURL=report-run.js.map