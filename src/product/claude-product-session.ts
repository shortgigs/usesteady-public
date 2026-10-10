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
 *     → answerScope(file)             → "prepared"  (narrowed + newly bound; fresh approval required)
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

import { runIntakeWithUCP }           from "../intake/intake-service.js";
import { DEFAULT_CONTRACT }           from "../interaction/defaults.js";
import { parseChange }                from "../understand/interpretation/parser.js";
import { isFsChange }                from "../understand/interpretation/types.js";
import type { ReplaceChange }        from "../understand/interpretation/types.js";
import {
  prepareClaudeExecution,
  deliverClaudeExecution,
} from "../execution/claude/claude-execution-coordinator.js";
import type {
  ClaudePreparationResult,
  ClaudeExecutionResult,
} from "../execution/claude/claude-execution-coordinator.js";
import {
  approveClaudeArtifact,
  bindClaudeArtifactEffectiveReceiver,
  narrowClaudeArtifactScope,
} from "../claude/artifact-mapper.js";
import {
  bindOnePath,
  bindReplaceChange,
  EFFECTIVE_RESOURCE_UNRESOLVED_MSG,
} from "../input/effective-resource.js";
import type {
  ClaudeAgentHandoffArtifact,
  ClaudeOCDPolicy,
  ClaudeScopeQuestion,
  ClaudeToolPolicy,
  ModelAdvisoryRecord,
  ModelRetirementRecord,
} from "../claude/index.js";
import type { ClaudeAgentPlugin }     from "../claude/delivery-gate.js";
import type { ParsedChange }          from "../understand/interpretation/types.js";
import type { ClaudeGateDeps }        from "../claude/delivery-gate.js";

// ─── Session phases ───────────────────────────────────────────────────────────

export type ClaudeSessionPhase =
  | "idle"           // no input submitted
  | "not_execute"    // intake ran; mode ≠ execute
  | "intake_failed"  // unexpected error during intake
  | "prepared"       // OCD cleared; awaiting H approval
  | "conflict"       // OCD fired a conflict; H must act before approval
  | "approved"       // H approved; ready to deliver
  | "scope_question" // Claude asked for scope clarification
  | "advisory"       // Claude emitted structured advisory position(s); parked for H supersession decision
  | "accepted"       // Claude accepted the task; session running
  | "exec_error"     // Claude returned an execution error
  | "blocked"        // gate blocked (ineligible, tool policy, or persistence failure)
  | "rejected";      // H rejected

// ─── Session state ────────────────────────────────────────────────────────────

export type ClaudeSessionState = {
  readonly phase: ClaudeSessionPhase;

  // Input
  readonly input?: string;
  readonly parsedChange?: ParsedChange;
  readonly workspaceRoot?: string;

  // Intake provenance
  readonly intentId?: string;
  readonly responseId?: string;

  // Current artifact (updated as H interacts)
  readonly artifact?: ClaudeAgentHandoffArtifact;

  // Preparation result (for display)
  readonly prepResult?: ClaudePreparationResult;

  // Scope question from Claude (set when phase === "scope_question")
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

  // Execution result (set when phase is a terminal execution outcome)
  readonly executionResult?: ClaudeExecutionResult;

  /**
   * preparedAt — Unix timestamp (ms) when the session first entered the
   * "prepared" or "conflict" phase. Set once; preserved through transitions.
   */
  readonly preparedAt?: number;

  // Phase-specific display text
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

// ─── Builders ─────────────────────────────────────────────────────────────────

function mkDisplay(d: {
  headline:         string;
  changeSummary?:   string | undefined;
  targetFiles?:     readonly string[] | undefined;
  conflicts?:       readonly string[] | undefined;
  scopeCandidates?: readonly string[] | undefined;
  resultNote?:      string | undefined;
}): ClaudeSessionDisplay {
  return Object.fromEntries(
    Object.entries(d).filter(([, v]) => v !== undefined),
  ) as ClaudeSessionDisplay;
}

type PartialClaudeSession = {
  [K in keyof ClaudeSessionState]?: ClaudeSessionState[K] | undefined;
} & { phase: ClaudeSessionPhase; display: ClaudeSessionDisplay };

function mk(s: PartialClaudeSession): ClaudeSessionState {
  return Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined),
  ) as ClaudeSessionState;
}

// ─── Session factory ──────────────────────────────────────────────────────────

const INITIAL_STATE: ClaudeSessionState = {
  phase:   "idle",
  display: { headline: "Ready. Submit a task for Claude." },
};

/**
 * Create a new Claude product session in the idle phase.
 */
export function createClaudeSession(): ClaudeSessionState {
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
export function submitClaude(
  state:      ClaudeSessionState,
  input:      string,
  policy:     ClaudeOCDPolicy,
  toolPolicy: ClaudeToolPolicy,
  precomputedPc?: ReplaceChange,
  workspaceRoot?: string,
): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;

  let ucpResult;
  try {
    ucpResult = runIntakeWithUCP(input, {
      prvContext:          { hasPriorSession: false },
      interactionContract: DEFAULT_CONTRACT,
    });
  } catch (err) {
    return mk({
      phase: "intake_failed",
      input,
      display: mkDisplay({ headline: `Intake error: ${String(err)}` }),
    });
  }

  const { result: intakeResult, ucp } = ucpResult;
  const intentId   = ucp.intent.id;
  const responseId = ucp.response.id;

  if (intakeResult.mode !== "execute") {
    const modeDisplay: Record<string, string> = {
      guide:   "Not an executable task — guidance available.",
      clarify: "Input is ambiguous — clarification needed.",
      refuse:  "Input refused — unsafe or out of scope.",
      ignore:  "Input does not require action.",
    };
    return mk({
      phase: "not_execute", input, intentId, responseId,
      display: mkDisplay({
        headline: modeDisplay[intakeResult.mode] ?? `Mode: ${intakeResult.mode}`,
      }),
    });
  }

  const rawPc = precomputedPc ?? (parseChange(input) ?? undefined);
  let pc: ReplaceChange | undefined = (rawPc && !isFsChange(rawPc)) ? rawPc : undefined;
  const root = workspaceRoot ?? "";
  if (pc !== undefined && pc.filePath !== undefined) {
    if (root.length === 0) {
      return mk({
        phase: "exec_error",
        input,
        display: mkDisplay({ headline: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} Refused before approval.` }),
      });
    }
    const bound = bindReplaceChange(pc, root);
    if (!bound.ok) {
      return mk({
        phase: "exec_error",
        input,
        workspaceRoot: root,
        display: mkDisplay({ headline: `${bound.message} Refused before approval.` }),
      });
    }
    pc = bound.parsed;
  }

  const prepResult = prepareClaudeExecution(
    intakeResult, intentId, responseId, policy, toolPolicy, pc,
  );

  if (prepResult.kind === "not_execute") {
    return mk({
      phase: "not_execute", input, intentId, responseId,
      display: mkDisplay({ headline: prepResult.reason }),
    });
  }

  const nextPhase: ClaudeSessionPhase =
    prepResult.kind === "conflict_detected" ? "conflict" : "prepared";

  return mk({
    phase:      nextPhase,
    input,
    ...(pc !== undefined ? { parsedChange: pc } : {}),
    ...(root.length > 0 ? { workspaceRoot: root } : {}),
    intentId,
    responseId,
    preparedAt: Date.now(),
    artifact:   prepResult.artifact,
    prepResult,
    display:    mkDisplay({
      headline:      prepResult.display.headline,
      changeSummary: prepResult.display.summary,
      ...(prepResult.display.targetFile
        ? { targetFiles: [prepResult.display.targetFile] }
        : {}),
      conflicts:     [...prepResult.display.conflicts],
    }),
  });
}

/**
 * H approves the prepared artifact. Transitions to "approved".
 * Only valid from "prepared" phase.
 */
export function approveClaude(
  state: ClaudeSessionState,
  at:    number = Date.now(),
): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  if (state.phase !== "prepared" || !state.artifact) {
    return invalidClaudeTransition(state, "approveClaude", "prepared");
  }
  const approved = approveClaudeArtifact(state.artifact, at);
  return mk({
    ...state,
    phase:    "approved",
    artifact: approved,
    display:  mkDisplay({
      headline:      "Approved. Ready to send to Claude.",
      changeSummary: state.display.changeSummary,
    }),
  });
}

/**
 * H accepts the OCD conflict. Transitions from "conflict" back to "prepared".
 */
export function acceptClaudeConflict(state: ClaudeSessionState): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  if (state.phase !== "conflict" || !state.artifact) {
    return invalidClaudeTransition(state, "acceptClaudeConflict", "conflict");
  }
  // Apply conflict_accepted clearance to the artifact
  const updated = {
    ...state.artifact,
    ocdClearance: "conflict_accepted" as const,
  };
  const { prepResult: _dropped, ...rest } = state;
  void _dropped;
  return mk({
    ...rest,
    phase:    "prepared",
    artifact: updated,
    display:  mkDisplay({
      headline:      "Conflict accepted. Ready to confirm.",
      changeSummary: state.display.changeSummary,
      targetFiles:   state.display.targetFiles,
      conflicts:     [],
    }),
  });
}

/**
 * H narrows the scope to a subset of the currently allowed files.
 * Monotonic: can only reduce, not expand. Re-evaluates display.
 * Valid from "prepared" or "scope_question".
 */
export function narrowClaude(
  state:        ClaudeSessionState,
  allowedFiles: readonly string[],
): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  if (
    (state.phase !== "prepared" && state.phase !== "scope_question")
    || !state.artifact
  ) {
    return invalidClaudeTransition(state, "narrowClaude", "prepared | scope_question");
  }
  const narrowed = narrowClaudeArtifactScope(state.artifact, allowedFiles);
  return mk({
    ...state,
    phase:    "prepared",
    artifact: narrowed,
    display:  mkDisplay({
      headline:      "Scope narrowed. Review and approve.",
      changeSummary: state.display.changeSummary,
      targetFiles:   [...allowedFiles],
      conflicts:     [],
    }),
  });
}

/**
 * H answers a scope question from Claude by selecting one candidate file.
 * Narrows to that file and stamps a new pending binding. Fresh approval
 * is required — this does not re-approve. Valid from "scope_question".
 */
export function answerClaudeScope(
  state: ClaudeSessionState,
  file:  string,
  at:    number = Date.now(),
  workspaceRoot?: string,
): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  if (state.phase !== "scope_question" || !state.artifact) {
    return invalidClaudeTransition(state, "answerClaudeScope", "scope_question");
  }
  if (state.scopeQuestion && !state.scopeQuestion.candidates.includes(file)) {
    return invalidClaudeTransition(
      state,
      "answerClaudeScope",
      `scope_question (file must be one of: ${state.scopeQuestion.candidates.join(", ")})`,
    );
  }
  void at;
  const narrowed = narrowClaudeArtifactScope(state.artifact, [file]);
  const parsed = narrowed.taskSpec.parsedChange;
  if (parsed === undefined) {
    return mk({
      phase: "exec_error",
      input: state.input,
      display: mkDisplay({ headline: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} Refused before approval.` }),
    });
  }
  const root = (workspaceRoot !== undefined && workspaceRoot.length > 0)
    ? workspaceRoot
    : (state.workspaceRoot ?? "");
  const pathToBind = file;
  if (root.length === 0) {
    return mk({
      phase: "exec_error",
      input: state.input,
      display: mkDisplay({ headline: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} Refused before approval.` }),
    });
  }
  const bound = bindOnePath(root, pathToBind);
  if (!bound.ok) {
    return mk({
      phase: "exec_error",
      input: state.input,
      workspaceRoot: root,
      display: mkDisplay({ headline: `${bound.message} Refused before approval.` }),
    });
  }
  if (parsed.oldValue === undefined || parsed.newValue === undefined) {
    return mk({
      phase: "exec_error",
      input: state.input,
      workspaceRoot: root,
      display: mkDisplay({ headline: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} Refused before approval.` }),
    });
  }
  const pending = bindClaudeArtifactEffectiveReceiver(narrowed, bound.bind, pathToBind);
  if (pending.eligibility === "approved_for_agent") {
    return mk({
      phase: "exec_error",
      input: state.input,
      workspaceRoot: root,
      display: mkDisplay({ headline: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} Refused before approval.` }),
    });
  }
  const boundParsed: ReplaceChange = {
    oldValue: parsed.oldValue,
    newValue: parsed.newValue,
    filePath: pathToBind,
    approvedEffective: bound.bind,
  };
  const { scopeQuestion: _answered, ...rest } = state;
  void _answered;
  return mk({
    ...rest,
    phase:         "prepared",
    artifact:      pending,
    parsedChange:  boundParsed,
    workspaceRoot: root,
    display:       mkDisplay({
      headline:      `Scope set to ${file}. Review the bound receiver and approve.`,
      changeSummary: state.display.changeSummary,
      targetFiles:   [file],
    }),
  });
}

/**
 * H rejects. Terminal state.
 */
export function rejectClaude(state: ClaudeSessionState): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  return mk({
    ...state,
    phase:   "rejected",
    display: mkDisplay({
      headline:      "Rejected.",
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
export function retireClaudeAdvisory(
  state: ClaudeSessionState,
  retirements: readonly ModelRetirementRecord[],
): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  if (state.phase !== "advisory" || !state.artifact) {
    return invalidClaudeTransition(state, "retireClaudeAdvisory", "advisory");
  }
  if (retirements.length === 0) {
    return invalidClaudeTransition(state, "retireClaudeAdvisory", "advisory");
  }
  const retired: readonly ModelRetirementRecord[] = [
    ...(state.retiredAdvisories ?? []),
    ...retirements,
  ];
  const { advisoryPositions: _dropped, ...rest } = state;
  void _dropped;
  return mk({
    ...rest,
    phase:             "approved",
    retiredAdvisories: retired,
    display:           mkDisplay({
      headline:      "Model position retired on named evidence (human decision).",
      changeSummary: state.display.changeSummary,
      targetFiles:   state.display.targetFiles,
    }),
  });
}

export function supersedeClaudeAdvisory(state: ClaudeSessionState): ClaudeSessionState {
  if (isClaudeTerminal(state)) return state;
  if (state.phase !== "advisory" || !state.artifact) {
    return invalidClaudeTransition(state, "supersedeClaudeAdvisory", "advisory");
  }
  const superseded: readonly ModelAdvisoryRecord[] = [
    ...(state.supersededAdvisories ?? []),
    ...(state.advisoryPositions ?? []),
  ];
  const { advisoryPositions: _dropped, ...rest } = state;
  void _dropped;
  return mk({
    ...rest,
    phase:                "approved",
    supersededAdvisories: superseded,
    display:              mkDisplay({
      headline:      "Proceeding despite the model advisory (human decision).",
      changeSummary: state.display.changeSummary,
      targetFiles:   state.display.targetFiles,
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
export async function deliverClaude(
  state:    ClaudeSessionState,
  plugin:   ClaudeAgentPlugin,
  storeDir: string,
  deps?:    ClaudeGateDeps,
): Promise<ClaudeSessionState> {
  if (isClaudeTerminal(state)) return state;
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
  const result = await deliverClaudeExecution(
    state.artifact,
    plugin,
    storeDir,
    deps,
    priorAdvisories !== undefined && priorAdvisories.length > 0
      ? priorAdvisories
      : undefined,
    retiredAdvisories !== undefined && retiredAdvisories.length > 0
      ? { retiredAdvisories, retiredPositions: retiredPositions ?? [] }
      : undefined,
  );

  switch (result.kind) {
    case "accepted":
      return mk({
        ...state,
        phase:           "accepted",
        executionResult: result,
        display:         mkDisplay({
          headline:      "Claude session started.",
          changeSummary: state.display.changeSummary,
          targetFiles:   state.display.targetFiles,
          resultNote:    `Session ID: ${result.sessionId}`,
        }),
      });

    case "retired_reassertion":
      // P5 V1: the model reasserted a retired position. Recorded; not standing;
      // do not park. Session stays approved so the caller can continue.
      return mk({
        ...state,
        phase:           "approved",
        executionResult: result,
        display:         mkDisplay({
          headline:      "Retired model position reasserted — recorded, not standing.",
          changeSummary: state.display.changeSummary,
          targetFiles:   state.display.targetFiles,
          resultNote:    result.display.note ?? undefined,
        }),
      });

    case "advisory":
      // P3 Phase 2: park. The advisory is NOT an execution outcome — no
      // acceptance, no refusal, no terminal transition. The task waits for an
      // explicit human supersession decision (supersedeClaudeAdvisory / rejectClaude).
      return mk({
        ...state,
        phase:             "advisory",
        advisoryPositions: result.positions,
        advisoryCycle:     (state.advisoryCycle ?? 0) + 1,
        executionResult:   result,
        display:           mkDisplay({
          headline:      "Claude recorded an advisory position about this action.",
          changeSummary: state.display.changeSummary,
          targetFiles:   state.display.targetFiles,
          resultNote:    result.display.note ?? undefined,
        }),
      });

    case "refused_due_to_scope":
      return mk({
        ...state,
        phase:           "scope_question",
        scopeQuestion:   result.scopeQuestion,
        executionResult: result,
        display:         mkDisplay({
          headline:        "Claude needs scope clarification.",
          changeSummary:   state.display.changeSummary,
          scopeCandidates: result.scopeQuestion.candidates,
          resultNote:      result.scopeQuestion.explanation,
        }),
      });

    case "refused_due_to_execution_error":
      return mk({
        ...state,
        phase:           "exec_error",
        executionResult: result,
        display:         mkDisplay({
          headline:   result.display.headline,
          resultNote: result.detail,
        }),
      });

    case "blocked_ineligible":
    case "blocked_tool_policy":
    case "blocked_persistence_failure": {
      const note = result.display.note ?? undefined;
      return mk({
        ...state,
        phase:           "blocked",
        executionResult: result,
        display:         mkDisplay({
          headline:   result.display.headline,
          ...(note ? { resultNote: note } : {}),
        }),
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the session is in a terminal phase. */
export function isClaudeTerminal(state: ClaudeSessionState): boolean {
  return (
    state.phase === "accepted"     ||
    state.phase === "rejected"     ||
    state.phase === "exec_error"   ||
    state.phase === "blocked"      ||
    state.phase === "not_execute"  ||
    state.phase === "intake_failed"
    // NOTE: "advisory" is NOT terminal — it is a park state awaiting an
    // explicit human supersession decision (P3 Phase 2).
  );
}

/** Returns true if the session accepted and started a Claude agent session. */
export function isClaudeAccepted(state: ClaudeSessionState): boolean {
  return state.phase === "accepted";
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function invalidClaudeTransition(
  state:    ClaudeSessionState,
  method:   string,
  expected: string,
): ClaudeSessionState {
  return mk({
    ...state,
    phase:   "blocked",
    display: mkDisplay({
      headline:   `Invalid transition: ${method}() called from phase "${state.phase}" (expected: ${expected}).`,
      resultNote: "Session is now blocked. Create a new session to continue.",
    }),
  });
}
