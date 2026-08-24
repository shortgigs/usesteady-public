/**
 * Claude Execution Coordinator — product seam wiring (Phase 8C).
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   The execution entry point for Claude Managed Agent requests.
 *
 *   Mirrors cursor-execution-coordinator.ts in structure:
 *
 *     prepareCursorExecution()    → prepareClaude Execution()
 *     deliverCursorExecution()    → deliverClaudeExecution()
 *
 *   Two phases. Same intent-separation as Cursor:
 *     Phase 1 (prepare): deterministic, synchronous, no side effects.
 *                        Builds the artifact, evaluates OCD, returns confirmation state.
 *     Phase 2 (deliver): async, requires H approval, dispatches to Claude API.
 *                        Calls the delivery gate with an already-approved artifact.
 *
 * ── OCD evaluation for Claude ──────────────────────────────────────────────────
 *
 *   Claude OCD is simpler than Cursor OCD at V1.
 *   The artifact already carries prohibitedPatterns from the mapper (ClaudeOCDPolicy).
 *
 *   The OCD check fires a conflict when parsedChange.filePath matches any
 *   prohibitedPattern glob. This surfaces the conflict to H before delivery.
 *   The delivery gate independently enforces prohibitedPatterns at delivery time
 *   (defense-in-depth: gate is the hard block, OCD is the early warning).
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a scheduler       — does not queue or retry
 *   NOT an OCD authority  — OCD fires conflicts; this surfaces them
 *   NOT a decision maker  — all decisions flow from intake + OCD + H approval
 *   NOT autonomous        — deliverClaudeExecution() requires an approved artifact
 *
 * ── Dependency direction ───────────────────────────────────────────────────────
 *
 *   Coordinator imports: intake types, claude module (all phases).
 *   Claude module NEVER imports this coordinator.
 *   Present layer NEVER imports this coordinator.
 *
 * ── Authority invariants preserved ────────────────────────────────────────────
 *
 *   - mode === "execute" is the only intake mode that opens Phase 1.
 *   - eligibility === "approved_for_agent" is the only state that opens Phase 2.
 *   - Raw input never crosses to Claude (enforced by ClaudeAgentHandoffArtifact shape).
 *   - executionDomain is derived once in buildClaudeHandoffArtifact (A1).
 *   - OCD fires conflicts; this surfaces them — never overrides them.
 *   - H approval is explicit (approveClaudeArtifact before deliverClaudeExecution).
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */
import type { IntakeResult } from "../../intake/types.js";
import type { ReplaceChange } from "../../understand/interpretation/types.js";
type ParsedChange = ReplaceChange;
import type { ClaudeAgentHandoffArtifact, ClaudeOCDPolicy, ClaudeScopeQuestion, ClaudeToolPolicy, ModelAdvisoryPosition, ModelAdvisoryRecord } from "../../claude/index.js";
import type { ClaudeAgentPlugin } from "../../claude/delivery-gate.js";
import type { ClaudeGateDeps } from "../../claude/delivery-gate.js";
/**
 * ClaudePreparationResult — returned by prepareClaudeExecution().
 *
 *   "ready_for_confirmation"  OCD cleared. Artifact awaits H approval.
 *   "conflict_detected"       OCD fired a conflict. H must review + acceptConflict before approving.
 *   "not_execute"             intakeResult.mode was not "execute". No artifact produced.
 */
export type ClaudePreparationResult = {
    readonly kind: "ready_for_confirmation";
    readonly artifact: ClaudeAgentHandoffArtifact;
    readonly display: ClaudePreparationDisplay;
} | {
    readonly kind: "conflict_detected";
    readonly artifact: ClaudeAgentHandoffArtifact;
    readonly display: ClaudePreparationDisplay;
} | {
    readonly kind: "not_execute";
    readonly reason: string;
};
/**
 * ClaudePreparationDisplay — consumer-ready strings for the Phase 1 result.
 *
 *   headline    — "Ready to delegate" / "Conflict detected"
 *   summary     — task description (from taskSpec.summary)
 *   targetFile  — the proposed target file from parsedChange, if known
 *   conflicts   — human-readable OCD conflict messages; empty when cleared
 */
export type ClaudePreparationDisplay = {
    readonly headline: string;
    readonly summary: string;
    readonly targetFile: string | null;
    readonly conflicts: readonly string[];
};
/**
 * ClaudeExecutionResult — returned by deliverClaudeExecution().
 *
 *   "accepted"                       Claude accepted the task and started a session.
 *   "refused_due_to_scope"           Claude needs H to clarify scope.
 *   "refused_due_to_execution_error" Claude could not proceed (network, auth, session error).
 *   "blocked_ineligible"             Artifact not approved. Caller error.
 *   "blocked_tool_policy"            Tool policy violation (networkAccess not "deny", etc.).
 *   "blocked_persistence_failure"    Handoff provenance could not be recorded.
 */
export type ClaudeExecutionResult = {
    readonly kind: "accepted";
    readonly deliveryId: string;
    readonly sessionId: string;
    readonly display: ClaudeExecutionDisplay;
} | {
    readonly kind: "refused_due_to_scope";
    readonly deliveryId: string;
    readonly scopeQuestion: ClaudeScopeQuestion;
    readonly display: ClaudeExecutionDisplay;
} | {
    /**
     * P3 Phase 2: the model emitted structured advisory position(s) and did
     * NOT execute. `positions` carries the gate-validated, durably persisted
     * evidence records (ucp.model_advisory.v1). The session layer parks on
     * this result; it is never an acceptance.
     */
    readonly kind: "advisory";
    readonly deliveryId: string;
    readonly positions: readonly ModelAdvisoryRecord[];
    readonly display: ClaudeExecutionDisplay;
} | {
    /**
     * P5 V1: every returned advisory was a reassertion of a retired
     * position. Recorded; not standing; not a park.
     */
    readonly kind: "retired_reassertion";
    readonly deliveryId: string;
    readonly reassertions: readonly ModelAdvisoryRecord[];
    readonly display: ClaudeExecutionDisplay;
} | {
    readonly kind: "refused_due_to_execution_error";
    readonly deliveryId: string;
    readonly errorCode: string;
    readonly detail: string;
    readonly display: ClaudeExecutionDisplay;
} | {
    readonly kind: "blocked_ineligible";
    readonly display: ClaudeExecutionDisplay;
} | {
    readonly kind: "blocked_tool_policy";
    readonly reason: string;
    readonly display: ClaudeExecutionDisplay;
} | {
    readonly kind: "blocked_persistence_failure";
    readonly reason: string;
    readonly display: ClaudeExecutionDisplay;
};
/**
 * ClaudeExecutionDisplay — consumer-ready strings for the Phase 2 result.
 */
export type ClaudeExecutionDisplay = {
    readonly verdict: "accepted" | "refused" | "blocked";
    readonly headline: string;
    readonly note: string | null;
};
/**
 * Build and OCD-evaluate a ClaudeAgentHandoffArtifact from an IntakeResult.
 *
 * Returns a preparation result describing what will happen and whether OCD
 * has any conflicts. Synchronous and side-effect-free.
 *
 * @param intakeResult  Output of runIntake(). Must have mode === "execute".
 * @param intentId      UCP envelope id of the intent.
 * @param responseId    UCP envelope id of the response.
 * @param policy        OCD policy (alwaysProhibitedGlobs, writeSafeGlobs).
 * @param toolPolicy    Tool policy (allowedTools, networkAccess, filesystemMode).
 * @param parsedChange  Optional: structured change parsed from the input.
 */
export declare function prepareClaudeExecution(intakeResult: IntakeResult, intentId: string, responseId: string, policy: ClaudeOCDPolicy, toolPolicy: ClaudeToolPolicy, parsedChange?: ParsedChange): ClaudePreparationResult;
/**
 * Deliver an already-approved ClaudeAgentHandoffArtifact through the delivery gate.
 *
 * Call this after H has called approveClaudeArtifact() on the prepared artifact.
 *
 * @param approvedArtifact  A ClaudeAgentHandoffArtifact with eligibility: "approved_for_agent".
 * @param plugin            The transport adapter (ClaudeApiAdapter or stub).
 * @param storeDir          Absolute path to the UCP store directory.
 * @param deps              Optional: injectable persistence fns for testing.
 * @param priorAdvisories   Optional (P3 Phase 2): advisory positions the human
 *                          has explicitly superseded for this artifact, carried
 *                          into the re-delivery request as informational context.
 */
export declare function deliverClaudeExecution(approvedArtifact: ClaudeAgentHandoffArtifact, plugin: ClaudeAgentPlugin, storeDir: string, deps?: ClaudeGateDeps, priorAdvisories?: readonly ModelAdvisoryPosition[], retired?: {
    readonly retiredAdvisories: readonly import("../../claude/types.js").RetiredAdvisoryContext[];
    readonly retiredPositions: readonly import("../../claude/objection-retirement.js").RetiredPositionRef[];
}): Promise<ClaudeExecutionResult>;
export {};
//# sourceMappingURL=claude-execution-coordinator.d.ts.map