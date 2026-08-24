/**
 * ClaudeProductSession — product-layer state machine (Phase 8C).
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Connects the intake engine + Claude delivery gate to real user interaction.
 *   Mirrors CursorProductSession in structure and philosophy.
 *
 *   The session manages one Claude agent request from user input through to
 *   execution outcome. It holds state between steps so the consumer (CLI, UI,
 *   plugin) only has to call the right method at the right moment.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT authority — this layer calls authority; it does not hold it.
 *   NOT a scheduler — one session = one agent task attempt.
 *   NOT a UI — it produces display strings; the caller renders them.
 *   NOT a router — intake mode still drives everything; this just surfaces it.
 *
 * ── Session lifecycle ─────────────────────────────────────────────────────────
 *
 *   idle
 *     → submit(input)                 → "prepared" | "conflict" | "not_execute" | "intake_failed"
 *
 *   prepared
 *     → approve()                     → "approved"
 *     → reject()                      → "rejected"
 *     → narrow(files)                 → "prepared"  (monotonic scope reduction)
 *
 *   conflict
 *     → acceptConflict()              → "prepared"  (conflict accepted, awaiting approval)
 *     → reject()                      → "rejected"
 *
 *   approved
 *     → deliver(plugin, storeDir)     → "accepted" | "scope_question" | "exec_error" | "blocked"
 *
 *   scope_question
 *     → answerScope(file)             → "approved"  (narrowed + re-approved)
 *     → reject()                      → "rejected"
 *
 *   Terminal: "accepted" | "rejected" | "not_execute" | "intake_failed" | "blocked" | "exec_error"
 *
 * ── Baseline truths (P1–P6, mirroring CursorProductSession) ──────────────────
 *
 *   P1 — Terminal states are immutable.
 *   P2 — Scope clarification is candidate-bounded.
 *   P3 — Approval is never execution (approve ≠ deliver).
 *   P4 — Delivery requires approved.
 *   P5 — Session carries state but has no independent authority.
 *   P6 — All authority lives upstream of the session.
 *
 * ── Dependency direction ───────────────────────────────────────────────────────
 *
 *   Session imports: intake, coordinator, claude module.
 *   Coordinator NEVER imports Session.
 *   Delivery gate NEVER imports Session.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */
import type { ReplaceChange } from "../understand/interpretation/types.js";
import type { ClaudePreparationResult, ClaudeExecutionResult } from "../execution/claude/claude-execution-coordinator.js";
import type { ClaudeAgentHandoffArtifact, ClaudeOCDPolicy, ClaudeScopeQuestion, ClaudeToolPolicy, ModelAdvisoryRecord, ModelRetirementRecord } from "../claude/index.js";
import type { ClaudeAgentPlugin } from "../claude/delivery-gate.js";
import type { ParsedChange } from "../understand/interpretation/types.js";
import type { ClaudeGateDeps } from "../claude/delivery-gate.js";
export type ClaudeSessionPhase = "idle" | "not_execute" | "intake_failed" | "prepared" | "conflict" | "approved" | "scope_question" | "advisory" | "accepted" | "exec_error" | "blocked" | "rejected";
export type ClaudeSessionState = {
    readonly phase: ClaudeSessionPhase;
    readonly input?: string;
    readonly parsedChange?: ParsedChange;
    readonly intentId?: string;
    readonly responseId?: string;
    readonly artifact?: ClaudeAgentHandoffArtifact;
    readonly prepResult?: ClaudePreparationResult;
    readonly scopeQuestion?: ClaudeScopeQuestion;
    /**
     * P3 Phase 2 — advisory positions for the CURRENT advisory episode (set when
     * phase === "advisory"). Gate-validated and durably persisted as
     * ucp.model_advisory.v1. Cleared on supersession (moved to
     * supersededAdvisories) or replaced on a subsequent advisory episode.
     */
    readonly advisoryPositions?: readonly ModelAdvisoryRecord[];
    /**
     * P3 Phase 2 — monotonic count of advisory episodes for this session's
     * artifact (1 after the first advisory response, incrementing on each
     * subsequent one). Drives the pending-approval gate cycle identity.
     */
    readonly advisoryCycle?: number;
    /**
     * P3 Phase 2 — cumulative history of advisory positions the human has
     * explicitly superseded. Never rewritten; each entry's modelPositionId is
     * the durable content-addressed id of the original advisory evidence.
     */
    readonly supersededAdvisories?: readonly ModelAdvisoryRecord[];
    /**
     * P5 V1 — cumulative history of advisory positions an authorized human
     * retired on named evidence. Separate from supersededAdvisories (P3
     * proceed-despite). Never rewritten. Original advisory envelopes untouched.
     */
    readonly retiredAdvisories?: readonly ModelRetirementRecord[];
    readonly executionResult?: ClaudeExecutionResult;
    /**
     * preparedAt — Unix timestamp (ms) when the session first entered the
     * "prepared" or "conflict" phase. Set once; preserved through transitions.
     */
    readonly preparedAt?: number;
    readonly display: ClaudeSessionDisplay;
};
export type ClaudeSessionDisplay = {
    /** Single-line headline for the current phase. */
    readonly headline: string;
    /** Task summary (if known). */
    readonly changeSummary?: string | undefined;
    /** File(s) in scope (if known). */
    readonly targetFiles?: readonly string[] | undefined;
    /** OCD conflict messages (if any). */
    readonly conflicts?: readonly string[] | undefined;
    /** Scope candidates (when phase === "scope_question"). */
    readonly scopeCandidates?: readonly string[] | undefined;
    /** Session / result note (when phase is a terminal execution outcome). */
    readonly resultNote?: string | undefined;
};
/**
 * Create a new Claude product session in the idle phase.
 */
export declare function createClaudeSession(): ClaudeSessionState;
/**
 * Submit user input. Runs intake + prepares the Claude artifact.
 *
 * @param input      The raw user text (e.g. "replace X with Y in src/Button.tsx").
 * @param policy     OCD policy for the workspace.
 * @param toolPolicy Tool policy for this Claude session.
 */
export declare function submitClaude(state: ClaudeSessionState, input: string, policy: ClaudeOCDPolicy, toolPolicy: ClaudeToolPolicy, precomputedPc?: ReplaceChange): ClaudeSessionState;
/**
 * H approves the prepared artifact. Transitions to "approved".
 * Only valid from "prepared" phase.
 */
export declare function approveClaude(state: ClaudeSessionState, at?: number): ClaudeSessionState;
/**
 * H accepts the OCD conflict. Transitions from "conflict" back to "prepared".
 */
export declare function acceptClaudeConflict(state: ClaudeSessionState): ClaudeSessionState;
/**
 * H narrows the scope to a subset of the currently allowed files.
 * Monotonic: can only reduce, not expand. Re-evaluates display.
 * Valid from "prepared" or "scope_question".
 */
export declare function narrowClaude(state: ClaudeSessionState, allowedFiles: readonly string[]): ClaudeSessionState;
/**
 * H answers a scope question from Claude by selecting one candidate file.
 * Narrows to that file and re-approves. Valid from "scope_question".
 */
export declare function answerClaudeScope(state: ClaudeSessionState, file: string, at?: number): ClaudeSessionState;
/**
 * H rejects. Terminal state.
 */
export declare function rejectClaude(state: ClaudeSessionState): ClaudeSessionState;
/**
 * H explicitly chooses to proceed despite the model's advisory position(s)
 * (P3 Phase 2). Valid ONLY from the "advisory" phase.
 *
 * This is a state transition, not an authority event: the durable supersession
 * relation (model_position_id → human authority decision) is bound by the
 * Portal-signed authority assertion on the pending-approval proof path. A
 * local (self-asserted) supersession is NOT a verified supersession record.
 *
 * The current episode's positions move to supersededAdvisories (cumulative,
 * never rewritten); the session returns to "approved" so the artifact can be
 * re-delivered. The original ucp.model_advisory.v1 envelopes are untouched.
 */
/**
 * H explicitly retires the current advisory position(s) on named evidence
 * (P5 V1). Valid ONLY from the "advisory" phase.
 *
 * Distinct from supersedeClaudeAdvisory (P3 proceed-despite). The original
 * advisory envelopes are untouched. Positions move to retiredAdvisories.
 * The session returns to "approved" so the artifact can be re-delivered
 * with the retired set as non-standing context.
 */
export declare function retireClaudeAdvisory(state: ClaudeSessionState, retirements: readonly ModelRetirementRecord[]): ClaudeSessionState;
export declare function supersedeClaudeAdvisory(state: ClaudeSessionState): ClaudeSessionState;
/**
 * Deliver the approved artifact to Claude through the execution gate.
 * Only valid from "approved" phase.
 *
 * @param plugin    The Claude transport adapter.
 * @param storeDir  Absolute path to UCP store directory.
 * @param deps      Optional injectable persistence fns for testing.
 */
export declare function deliverClaude(state: ClaudeSessionState, plugin: ClaudeAgentPlugin, storeDir: string, deps?: ClaudeGateDeps): Promise<ClaudeSessionState>;
/** Returns true if the session is in a terminal phase. */
export declare function isClaudeTerminal(state: ClaudeSessionState): boolean;
/** Returns true if the session accepted and started a Claude agent session. */
export declare function isClaudeAccepted(state: ClaudeSessionState): boolean;
//# sourceMappingURL=claude-product-session.d.ts.map