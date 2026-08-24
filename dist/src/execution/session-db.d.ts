/**
 * Execution Control — SQLite persistence layer.
 *
 * Hardening additions (Phase 2 guardrails):
 *   - decided_at column: records exact decision timestamp (observability).
 *   - updateStepDecision: idempotent — returns { updated, alreadyDecided }.
 *   - getSessionStats: lightweight counters for time-to-first-decision,
 *     approval rate, reject rate by action_type, high-risk approval rate.
 *
 * Design rules (mirroring server-store.ts conventions):
 *   1. One singleton DB connection per process.
 *   2. Never throws on schema init — errors propagate to the caller.
 *   3. IDs are generated here (randomUUID), not by the client.
 *   4. system_will is stored as JSON text (SQLite has no native jsonb).
 */
import type { ExecutionStep } from "../types/execution.js";
export declare const REVERT_LATENCY: {
    readonly MISCLICK_MAX: 5;
    readonly UNCERTAIN_MAX: 20;
};
export declare const RAPID_REAPPROVAL_SEC = 10;
export type RevertBand = "misclick" | "uncertain" | "comprehension";
export declare function classifyRevertBand(sec: number): RevertBand;
export declare function createSession(storeDir: string, workspacePath: string): string;
export declare function insertSteps(storeDir: string, sessionId: string, steps: ExecutionStep[]): void;
/**
 * Idempotent decision update.
 *
 * Returns:
 *   updated: true         → decision applied, decided_at recorded.
 *   alreadyDecided: true  → step was already decided, no write performed.
 *   rapidReapproval: true → step was reverted and re-approved within
 *                           RAPID_REAPPROVAL_SEC seconds. Signals first-read
 *                           clarity failure (the user understood on re-read).
 *                           Cross-reference with [uncertain] revert band.
 *
 * A step that is already 'approved' or 'rejected' cannot be changed via
 * this function. Any "change decision" path must be a separate, explicit
 * operation (not yet implemented — blocked until Phase 3 undo is scoped).
 */
export declare function updateStepDecision(storeDir: string, stepId: string, decision: "approved" | "rejected"): {
    updated: boolean;
    alreadyDecided: boolean;
    previousStatus?: string;
    rapidReapproval: boolean;
    reapprovalSec: number | null;
};
export type SessionStats = {
    total: number;
    decided: number;
    approved: number;
    rejected: number;
    /** Seconds from session creation to first decision. null if no decisions yet. */
    timeToFirstDecisionSec: number | null;
    /** 0–1 fraction. null if no decisions yet. */
    approvalRate: number | null;
    /** Fraction of HIGH risk steps that were approved. null if none decided yet. */
    highRiskApprovalRate: number | null;
    /**
     * Reject count per action_type (absolute counts, not rates).
     * Only includes action_types that have at least one decided step.
     * Use this to identify which operation classes produce the most friction.
     */
    rejectRateByActionType: Record<string, number>;
    /**
     * Hesitation index: revert_count / approved.
     *
     * Interpretation:
     *   High  → users are unsure → SYSTEM WILL clarity or risk labeling issue.
     *   ~Zero → confidence is high → model is working.
     *   null  → no approvals yet, cannot compute.
     */
    hesitationIndex: number | null;
    /** Raw revert count — number of times an approval was rolled back in this session. */
    revertCount: number;
};
export declare function getSessionStats(storeDir: string, sessionId: string): SessionStats;
export type TimelineEntry = {
    stepId: string;
    stepIndex: number;
    action_type: ExecutionStep["action_type"];
    file_path: string;
    risk_level: ExecutionStep["risk_level"];
    decision: "approved" | "rejected";
    decided_at: string;
    summary: string;
};
/**
 * Returns all decided steps for a session, ordered by decided_at ASC.
 * Only includes steps with status 'approved' or 'rejected'.
 * summary is extracted from system_will.summary for display.
 */
export declare function getSessionTimeline(storeDir: string, sessionId: string): TimelineEntry[];
export type UndoResult = {
    success: true;
    stepId: string;
    file_path: string;
    action_type: string;
    /**
     * Seconds elapsed between the original approval and this revert.
     * null when decided_at was missing (pre-migration rows).
     */
    approveToRevertSec: number | null;
    /**
     * Latency band at revert time — stored on the step so re-approve can
     * validate [clarity_friction] without re-deriving from timestamps.
     * null when approveToRevertSec is null.
     */
    revertBand: RevertBand | null;
} | {
    success: false;
    reason: "no_approved_steps" | "step_not_found";
};
/**
 * Reverts the most-recently approved step in a session back to 'pending'.
 *
 * Bounded scope:
 *   - Only reverts ONE step per call (caller must explicitly call again to undo more).
 *   - Only reverts 'approved' → 'pending'. Rejected steps are not undone here.
 *   - Clears decided_at so the step re-appears as undecided in the timeline.
 *
 * This is a decision-layer revert, not a filesystem revert. Files have not
 * been written — the approval gate is still in front of execution.
 */
export declare function undoLastApproval(storeDir: string, sessionId: string): UndoResult;
/** Returns the session_id for a given step, or null if not found. */
export declare function getStepSessionId(storeDir: string, stepId: string): string | null;
/**
 * Return all steps for a session ordered by step_index ASC.
 * Ordering is deterministic: step_index is assigned at insert time (0-based)
 * and never mutated, so ORDER BY step_index always matches insertion order.
 */
export declare function getSessionSteps(storeDir: string, sessionId: string): ExecutionStep[];
//# sourceMappingURL=session-db.d.ts.map