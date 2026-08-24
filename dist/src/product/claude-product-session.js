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
import { runIntakeWithUCP } from "../intake/intake-service.js";
import { DEFAULT_CONTRACT } from "../interaction/defaults.js";
import { parseChange } from "../understand/interpretation/parser.js";
import { isFsChange } from "../understand/interpretation/types.js";
import { prepareClaudeExecution, deliverClaudeExecution, } from "../execution/claude/claude-execution-coordinator.js";
import { approveClaudeArtifact, narrowClaudeArtifactScope, } from "../claude/artifact-mapper.js";
// ─── Builders ─────────────────────────────────────────────────────────────────
function mkDisplay(d) {
    return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}
function mk(s) {
    return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
}
// ─── Session factory ──────────────────────────────────────────────────────────
const INITIAL_STATE = {
    phase: "idle",
    display: { headline: "Ready. Submit a task for Claude." },
};
/**
 * Create a new Claude product session in the idle phase.
 */
export function createClaudeSession() {
    return INITIAL_STATE;
}
// ─── Session transitions ──────────────────────────────────────────────────────
/**
 * Submit user input. Runs intake + prepares the Claude artifact.
 *
 * @param input      The raw user text (e.g. "replace X with Y in src/Button.tsx").
 * @param policy     OCD policy for the workspace.
 * @param toolPolicy Tool policy for this Claude session.
 */
export function submitClaude(state, input, policy, toolPolicy, precomputedPc) {
    if (isClaudeTerminal(state))
        return state;
    let ucpResult;
    try {
        ucpResult = runIntakeWithUCP(input, {
            prvContext: { hasPriorSession: false },
            interactionContract: DEFAULT_CONTRACT,
        });
    }
    catch (err) {
        return mk({
            phase: "intake_failed",
            input,
            display: mkDisplay({ headline: `Intake error: ${String(err)}` }),
        });
    }
    const { result: intakeResult, ucp } = ucpResult;
    const intentId = ucp.intent.id;
    const responseId = ucp.response.id;
    if (intakeResult.mode !== "execute") {
        const modeDisplay = {
            guide: "Not an executable task — guidance available.",
            clarify: "Input is ambiguous — clarification needed.",
            refuse: "Input refused — unsafe or out of scope.",
            ignore: "Input does not require action.",
        };
        return mk({
            phase: "not_execute", input, intentId, responseId,
            display: mkDisplay({
                headline: modeDisplay[intakeResult.mode] ?? `Mode: ${intakeResult.mode}`,
            }),
        });
    }
    const rawPc = precomputedPc ?? (parseChange(input) ?? undefined);
    const pc = (rawPc && !isFsChange(rawPc)) ? rawPc : undefined;
    const prepResult = prepareClaudeExecution(intakeResult, intentId, responseId, policy, toolPolicy, pc);
    if (prepResult.kind === "not_execute") {
        return mk({
            phase: "not_execute", input, intentId, responseId,
            display: mkDisplay({ headline: prepResult.reason }),
        });
    }
    const nextPhase = prepResult.kind === "conflict_detected" ? "conflict" : "prepared";
    return mk({
        phase: nextPhase,
        input,
        ...(pc !== undefined ? { parsedChange: pc } : {}),
        intentId,
        responseId,
        preparedAt: Date.now(),
        artifact: prepResult.artifact,
        prepResult,
        display: mkDisplay({
            headline: prepResult.display.headline,
            changeSummary: prepResult.display.summary,
            ...(prepResult.display.targetFile
                ? { targetFiles: [prepResult.display.targetFile] }
                : {}),
            conflicts: [...prepResult.display.conflicts],
        }),
    });
}
/**
 * H approves the prepared artifact. Transitions to "approved".
 * Only valid from "prepared" phase.
 */
export function approveClaude(state, at = Date.now()) {
    if (isClaudeTerminal(state))
        return state;
    if (state.phase !== "prepared" || !state.artifact) {
        return invalidClaudeTransition(state, "approveClaude", "prepared");
    }
    const approved = approveClaudeArtifact(state.artifact, at);
    return mk({
        ...state,
        phase: "approved",
        artifact: approved,
        display: mkDisplay({
            headline: "Approved. Ready to send to Claude.",
            changeSummary: state.display.changeSummary,
        }),
    });
}
/**
 * H accepts the OCD conflict. Transitions from "conflict" back to "prepared".
 */
export function acceptClaudeConflict(state) {
    if (isClaudeTerminal(state))
        return state;
    if (state.phase !== "conflict" || !state.artifact) {
        return invalidClaudeTransition(state, "acceptClaudeConflict", "conflict");
    }
    // Apply conflict_accepted clearance to the artifact
    const updated = {
        ...state.artifact,
        ocdClearance: "conflict_accepted",
    };
    const { prepResult: _dropped, ...rest } = state;
    void _dropped;
    return mk({
        ...rest,
        phase: "prepared",
        artifact: updated,
        display: mkDisplay({
            headline: "Conflict accepted. Ready to confirm.",
            changeSummary: state.display.changeSummary,
            targetFiles: state.display.targetFiles,
            conflicts: [],
        }),
    });
}
/**
 * H narrows the scope to a subset of the currently allowed files.
 * Monotonic: can only reduce, not expand. Re-evaluates display.
 * Valid from "prepared" or "scope_question".
 */
export function narrowClaude(state, allowedFiles) {
    if (isClaudeTerminal(state))
        return state;
    if ((state.phase !== "prepared" && state.phase !== "scope_question")
        || !state.artifact) {
        return invalidClaudeTransition(state, "narrowClaude", "prepared | scope_question");
    }
    const narrowed = narrowClaudeArtifactScope(state.artifact, allowedFiles);
    return mk({
        ...state,
        phase: "prepared",
        artifact: narrowed,
        display: mkDisplay({
            headline: "Scope narrowed. Review and approve.",
            changeSummary: state.display.changeSummary,
            targetFiles: [...allowedFiles],
            conflicts: [],
        }),
    });
}
/**
 * H answers a scope question from Claude by selecting one candidate file.
 * Narrows to that file and re-approves. Valid from "scope_question".
 */
export function answerClaudeScope(state, file, at = Date.now()) {
    if (isClaudeTerminal(state))
        return state;
    if (state.phase !== "scope_question" || !state.artifact) {
        return invalidClaudeTransition(state, "answerClaudeScope", "scope_question");
    }
    if (state.scopeQuestion && !state.scopeQuestion.candidates.includes(file)) {
        return invalidClaudeTransition(state, "answerClaudeScope", `scope_question (file must be one of: ${state.scopeQuestion.candidates.join(", ")})`);
    }
    const narrowed = narrowClaudeArtifactScope(state.artifact, [file]);
    const approved = approveClaudeArtifact(narrowed, at);
    return mk({
        ...state,
        phase: "approved",
        artifact: approved,
        display: mkDisplay({
            headline: `Scope set to ${file}. Approved.`,
            changeSummary: state.display.changeSummary,
            targetFiles: [file],
        }),
    });
}
/**
 * H rejects. Terminal state.
 */
export function rejectClaude(state) {
    if (isClaudeTerminal(state))
        return state;
    return mk({
        ...state,
        phase: "rejected",
        display: mkDisplay({
            headline: "Rejected.",
            changeSummary: state.display.changeSummary,
        }),
    });
}
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
export function retireClaudeAdvisory(state, retirements) {
    if (isClaudeTerminal(state))
        return state;
    if (state.phase !== "advisory" || !state.artifact) {
        return invalidClaudeTransition(state, "retireClaudeAdvisory", "advisory");
    }
    if (retirements.length === 0) {
        return invalidClaudeTransition(state, "retireClaudeAdvisory", "advisory");
    }
    const retired = [
        ...(state.retiredAdvisories ?? []),
        ...retirements,
    ];
    const { advisoryPositions: _dropped, ...rest } = state;
    void _dropped;
    return mk({
        ...rest,
        phase: "approved",
        retiredAdvisories: retired,
        display: mkDisplay({
            headline: "Model position retired on named evidence (human decision).",
            changeSummary: state.display.changeSummary,
            targetFiles: state.display.targetFiles,
        }),
    });
}
export function supersedeClaudeAdvisory(state) {
    if (isClaudeTerminal(state))
        return state;
    if (state.phase !== "advisory" || !state.artifact) {
        return invalidClaudeTransition(state, "supersedeClaudeAdvisory", "advisory");
    }
    const superseded = [
        ...(state.supersededAdvisories ?? []),
        ...(state.advisoryPositions ?? []),
    ];
    const { advisoryPositions: _dropped, ...rest } = state;
    void _dropped;
    return mk({
        ...rest,
        phase: "approved",
        supersededAdvisories: superseded,
        display: mkDisplay({
            headline: "Proceeding despite the model advisory (human decision).",
            changeSummary: state.display.changeSummary,
            targetFiles: state.display.targetFiles,
        }),
    });
}
/**
 * Deliver the approved artifact to Claude through the execution gate.
 * Only valid from "approved" phase.
 *
 * @param plugin    The Claude transport adapter.
 * @param storeDir  Absolute path to UCP store directory.
 * @param deps      Optional injectable persistence fns for testing.
 */
export async function deliverClaude(state, plugin, storeDir, deps) {
    if (isClaudeTerminal(state))
        return state;
    if (state.phase !== "approved" || !state.artifact) {
        return invalidClaudeTransition(state, "deliverClaude", "approved");
    }
    const priorAdvisories = state.supersededAdvisories?.map((r) => r.position);
    const retiredAdvisories = state.retiredAdvisories?.map((r) => ({
        position: r.record.position,
        modelPositionId: r.record.modelPositionId,
        resolvingEvidenceIds: r.resolvingEvidenceIds,
        ...(r.mappedRelation !== undefined
            ? {
                mappedEvidence: {
                    evidenceBasisId: r.mappedRelation.evidenceBasisId,
                    evidenceBasisHash: r.mappedRelation.evidenceBasisHash,
                },
            }
            : {}),
    }));
    const retiredPositions = state.retiredAdvisories?.map((r) => ({
        modelPositionId: r.record.modelPositionId,
        positionHash: r.record.evidenceEnvelopeId,
        groundsId: r.groundsId,
        resolvingEvidenceIds: r.resolvingEvidenceIds,
        retirementEnvelopeId: r.retirementEnvelopeId,
    }));
    const result = await deliverClaudeExecution(state.artifact, plugin, storeDir, deps, priorAdvisories !== undefined && priorAdvisories.length > 0
        ? priorAdvisories
        : undefined, retiredAdvisories !== undefined && retiredAdvisories.length > 0
        ? { retiredAdvisories, retiredPositions: retiredPositions ?? [] }
        : undefined);
    switch (result.kind) {
        case "accepted":
            return mk({
                ...state,
                phase: "accepted",
                executionResult: result,
                display: mkDisplay({
                    headline: "Claude session started.",
                    changeSummary: state.display.changeSummary,
                    targetFiles: state.display.targetFiles,
                    resultNote: `Session ID: ${result.sessionId}`,
                }),
            });
        case "retired_reassertion":
            // P5 V1: the model reasserted a retired position. Recorded; not standing;
            // do not park. Session stays approved so the caller can continue.
            return mk({
                ...state,
                phase: "approved",
                executionResult: result,
                display: mkDisplay({
                    headline: "Retired model position reasserted — recorded, not standing.",
                    changeSummary: state.display.changeSummary,
                    targetFiles: state.display.targetFiles,
                    resultNote: result.display.note ?? undefined,
                }),
            });
        case "advisory":
            // P3 Phase 2: park. The advisory is NOT an execution outcome — no
            // acceptance, no refusal, no terminal transition. The task waits for an
            // explicit human supersession decision (supersedeClaudeAdvisory / rejectClaude).
            return mk({
                ...state,
                phase: "advisory",
                advisoryPositions: result.positions,
                advisoryCycle: (state.advisoryCycle ?? 0) + 1,
                executionResult: result,
                display: mkDisplay({
                    headline: "Claude recorded an advisory position about this action.",
                    changeSummary: state.display.changeSummary,
                    targetFiles: state.display.targetFiles,
                    resultNote: result.display.note ?? undefined,
                }),
            });
        case "refused_due_to_scope":
            return mk({
                ...state,
                phase: "scope_question",
                scopeQuestion: result.scopeQuestion,
                executionResult: result,
                display: mkDisplay({
                    headline: "Claude needs scope clarification.",
                    changeSummary: state.display.changeSummary,
                    scopeCandidates: result.scopeQuestion.candidates,
                    resultNote: result.scopeQuestion.explanation,
                }),
            });
        case "refused_due_to_execution_error":
            return mk({
                ...state,
                phase: "exec_error",
                executionResult: result,
                display: mkDisplay({
                    headline: result.display.headline,
                    resultNote: result.detail,
                }),
            });
        case "blocked_ineligible":
        case "blocked_tool_policy":
        case "blocked_persistence_failure": {
            const note = result.display.note ?? undefined;
            return mk({
                ...state,
                phase: "blocked",
                executionResult: result,
                display: mkDisplay({
                    headline: result.display.headline,
                    ...(note ? { resultNote: note } : {}),
                }),
            });
        }
    }
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Returns true if the session is in a terminal phase. */
export function isClaudeTerminal(state) {
    return (state.phase === "accepted" ||
        state.phase === "rejected" ||
        state.phase === "exec_error" ||
        state.phase === "blocked" ||
        state.phase === "not_execute" ||
        state.phase === "intake_failed"
    // NOTE: "advisory" is NOT terminal — it is a park state awaiting an
    // explicit human supersession decision (P3 Phase 2).
    );
}
/** Returns true if the session accepted and started a Claude agent session. */
export function isClaudeAccepted(state) {
    return state.phase === "accepted";
}
// ─── Internal ─────────────────────────────────────────────────────────────────
function invalidClaudeTransition(state, method, expected) {
    return mk({
        ...state,
        phase: "blocked",
        display: mkDisplay({
            headline: `Invalid transition: ${method}() called from phase "${state.phase}" (expected: ${expected}).`,
            resultNote: "Session is now blocked. Create a new session to continue.",
        }),
    });
}
//# sourceMappingURL=claude-product-session.js.map