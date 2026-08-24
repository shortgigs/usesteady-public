/**
 * CursorProductSession — product-layer state machine.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Connects the execution engine to real user interaction flows.
 *   This is the "who calls the seam, and how does the user see it" layer.
 *
 *   The session manages one edit request from user input through to execution
 *   outcome. It holds state between steps so the consumer (CLI, UI, plugin)
 *   only has to call the right method at the right moment.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT authority — this layer calls authority; it does not hold it.
 *   NOT a scheduler — one session = one edit attempt.
 *   NOT a UI — it produces display strings; the caller renders them.
 *   NOT a router — intake mode still drives everything; this just surfaces it.
 *
 * ── Baseline truths (locked — see docs/cursor-v1-baseline.md) ────────────────
 *
 *   P1 — Terminal states are immutable.
 *        Once a session reaches accepted / rejected / exec_error / blocked /
 *        not_execute / intake_failed, all further transition calls return the
 *        same state object unchanged. A new session must be created for a new
 *        edit attempt. Enforced by isTerminal() guard at the top of every
 *        public transition function.
 *
 *   P2 — Scope clarification is candidate-bounded.
 *        answerScope(state, file) rejects any file not present in
 *        state.scopeQuestion.candidates. Cursor surfaced exactly those
 *        candidates; choosing outside them is silent scope expansion.
 *
 *   P3 — Approval is never execution.
 *        approve() transitions to "approved", not "accepted".
 *        deliver() is a separate explicit act by the product shell.
 *        These two steps must never be collapsed into one.
 *
 *   P4 — Delivery requires approved.
 *        deliver() called from any phase other than "approved" returns
 *        "blocked". The gate inside deliverCursorExecution() also
 *        independently checks eligibility. Defense-in-depth.
 *
 *   P5 — Session carries state but has no independent authority.
 *        The session holds the artifact and display fields.
 *        Authority lives in: intake (mode), OCD/policy (constraints),
 *        H (approval, narrowing), and the delivery gate (eligibility).
 *        The session is the carrier and transition guard — nothing more.
 *
 *   P6 — All authority lives upstream of the session.
 *        intake  → sole mode authority
 *        OCD     → sole policy authority
 *        H       → sole approval authority
 *        gate    → sole delivery eligibility authority
 *        Session → no authority of its own
 *
 * ── Session lifecycle ─────────────────────────────────────────────────────────
 *
 *   idle
 *     → submit(input)                 → "prepared" | "conflict" | "not_execute" | "intake_failed"
 *
 *   prepared
 *     → approve()                     → "approved"
 *     → reject()                      → "rejected"
 *     → narrow(files)                 → "prepared"  (re-evaluated after narrow)
 *
 *   conflict
 *     → acceptConflict()              → "prepared"  (re-evaluated OCD status)
 *     → reject()                      → "rejected"
 *
 *   approved
 *     → deliver(plugin, storeDir)     → "accepted" | "scope_question" | "exec_error" | "blocked"
 *
 *   scope_question
 *     → answerScope(file)             → "approved"  (narrowed + re-approved)
 *     → reject()                      → "rejected"
 *
 *   Terminal: "accepted" | "rejected" | "not_execute" | "intake_failed" | "blocked"
 *
 * ── Dependency direction ───────────────────────────────────────────────────────
 *
 *   Session imports: intake, coordinator, cursor module.
 *   Coordinator NEVER imports Session.
 *   Delivery gate NEVER imports Session.
 */
import { deliverCursorExecution } from "../execution/cursor/cursor-execution-coordinator.js";
import type { CursorPreparationResult, CursorExecutionResult, CursorPresentHints } from "../execution/cursor/cursor-execution-coordinator.js";
import type { CursorHandoffArtifact, CursorOCDPolicy, CursorScopeQuestion } from "../cursor/types.js";
import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
import type { FsChange, ReplaceChange } from "../understand/interpretation/types.js";
export type SessionPhase = "idle" | "not_execute" | "intake_failed" | "prepared" | "conflict" | "approved" | "scope_question" | "accepted" | "exec_error" | "blocked" | "rejected";
export type CursorSessionState = {
    readonly phase: SessionPhase;
    readonly input?: string;
    readonly parsedChange?: ReplaceChange;
    /**
     * Deterministic filesystem operation parsed from structured NL input.
     * Set when the interactive REPL (or submit) detects an FsChange via
     * parseChange(). Executed via FsPlugin.executeFsOp — never stuffed
     * into parsedChange or the replace artifact path.
     */
    readonly fsOp?: FsChange;
    readonly intentId?: string;
    readonly responseId?: string;
    readonly artifact?: CursorHandoffArtifact;
    readonly prepResult?: CursorPreparationResult;
    /**
     * presentHints — wiring bridge for Phase 5D contradiction visibility.
     *
     * Pass to presentFromInput(rawInput, intakeResult, trace, policyHint, parsedChangeHint)
     * so the present coordinator can detect policy_may_block_target for prohibited
     * target paths in execute-mode flows.
     *
     *   policyHint:       { prohibitedGlobs: state.presentHints.prohibitedGlobs }
     *   parsedChangeHint: { filePath: state.presentHints.parsedChangeFilePath }
     *
     * Set when phase transitions to "prepared" or "conflict". Preserved through
     * subsequent transitions. Cleared only when a new session is created.
     */
    readonly presentHints?: CursorPresentHints;
    readonly scopeQuestion?: CursorScopeQuestion;
    readonly executionResult?: CursorExecutionResult;
    /**
     * preparedAt — Unix timestamp (ms) when the session first entered the
     * "prepared" or "conflict" phase.
     *
     * Phase 6C: used by evaluateSessionStaleness() to compute session age.
     * Not set for idle, not_execute, intake_failed, or terminal phases.
     * Set once on the first prepare; preserved through subsequent transitions.
     */
    readonly preparedAt?: number;
    readonly display: SessionDisplay;
};
export type SessionDisplay = {
    /** Single-line headline for the current phase. */
    readonly headline: string;
    /** Summary of the proposed change (if known). */
    readonly changeSummary?: string | undefined;
    /** File(s) in scope (if known). */
    readonly targetFiles?: readonly string[] | undefined;
    /** OCD conflict messages (if any). */
    readonly conflicts?: readonly string[] | undefined;
    /** Scope candidates (when phase === "scope_question"). */
    readonly scopeCandidates?: readonly string[] | undefined;
    /** Result note (when phase is a terminal execution outcome). */
    readonly resultNote?: string | undefined;
};
/**
 * Create a new product session in the idle phase.
 */
export declare function createSession(): CursorSessionState;
/**
 * Submit user input. Runs intake + prepare. Returns next session state.
 *
 * @param input   The raw user text (e.g. "change button color to red").
 * @param policy  OCD policy for the workspace.
 */
export declare function submit(state: CursorSessionState, input: string, policy: CursorOCDPolicy, precomputedPc?: ReplaceChange): CursorSessionState;
/**
 * Async variant of submit that enriches guide-mode results with LLM classification.
 *
 * Use in the single-session CLI cursor mode where:
 *   - The bridge was silent (no interpreter claimed the input)
 *   - The user should see a rewrite suggestion, clarification, or boundary guidance
 *     rather than a generic headline
 *
 * Falls back to the same result as submit() when:
 *   - mode !== "guide" (no LLM call made)
 *   - The bridge already fired (interpretation already present)
 *   - ANTHROPIC_API_KEY is not set
 *   - The LLM call fails for any reason
 */
export declare function submitAsync(state: CursorSessionState, input: string, policy: CursorOCDPolicy): Promise<CursorSessionState>;
/**
 * H approves the prepared artifact. Transitions to "approved".
 * Only valid from "prepared" phase.
 */
export declare function approve(state: CursorSessionState, at?: number): CursorSessionState;
/**
 * H accepts the OCD conflict. Transitions from "conflict" back to "prepared".
 */
export declare function acceptConflict(state: CursorSessionState): CursorSessionState;
/**
 * H narrows the scope to a subset of the currently allowed files.
 * Monotonic: can only reduce, not expand. Re-evaluates display.
 * Valid from "prepared" or "scope_question".
 */
export declare function narrow(state: CursorSessionState, allowedFiles: readonly string[]): CursorSessionState;
/**
 * H answers a scope question by selecting a single candidate file.
 * The session narrows to that file and re-approves automatically.
 * Valid from "scope_question".
 */
export declare function answerScope(state: CursorSessionState, file: string, at?: number): CursorSessionState;
/**
 * H rejects. Terminal state.
 */
export declare function reject(state: CursorSessionState): CursorSessionState;
/**
 * Deliver the approved artifact through the execution gate.
 * Only valid from "approved" phase. Returns a terminal or "scope_question" state.
 *
 * @param plugin    The transport adapter (CursorInProcessAdapter for real edits).
 * @param storeDir  Absolute path to UCP store directory.
 * @param deps      Optional injectable persistence fns for testing.
 */
export declare function deliver(state: CursorSessionState, plugin: CursorEditorPlugin, storeDir: string, deps?: Parameters<typeof deliverCursorExecution>[3]): Promise<CursorSessionState>;
/** Returns true if the session is in a terminal phase (no further transitions). */
export declare function isTerminal(state: CursorSessionState): boolean;
/**
 * Extract contradiction-visibility args for presentFromInput().
 *
 * Call this after submit() to get the policyHint and parsedChangeHint that
 * enable Phase 5D cross-layer contradiction detection. Pass the result
 * arguments directly to presentFromInput():
 *
 *   const { policyHint, parsedChangeHint } = getPresentHints(state);
 *   presentFromInput(rawInput, intakeResult, undefined, policyHint, parsedChangeHint);
 *
 * Returns undefined for both hints when the session has no presentHints
 * (e.g. idle, not_execute, intake_failed phases).
 */
export declare function getPresentHints(state: CursorSessionState): {
    policyHint: {
        readonly prohibitedGlobs: readonly string[];
    } | undefined;
    parsedChangeHint: {
        readonly filePath?: string;
    } | undefined;
};
/** Returns true if the session accepted and applied an edit. */
export declare function isAccepted(state: CursorSessionState): boolean;
//# sourceMappingURL=cursor-product-session.d.ts.map