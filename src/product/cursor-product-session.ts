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
 *     → answerScope(file)             → "prepared"  (narrowed + newly bound; fresh approval required)
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

import { runIntakeWithUCP, runIntakeWithLLM } from "../intake/intake-service.js";
import type { GuidancePayload }              from "../intake/types.js";
import { capture as phCapture }             from "../friction/posthog.js";
import { DEFAULT_CONTRACT }         from "../interaction/defaults.js";
import { parseChange }              from "../understand/interpretation/parser.js";
import {
  prepareCursorExecution,
  deliverCursorExecution,
} from "../execution/cursor/cursor-execution-coordinator.js";
import type {
  CursorPreparationResult,
  CursorExecutionResult,
  CursorPresentHints,
} from "../execution/cursor/cursor-execution-coordinator.js";
import {
  approveArtifact,
  bindArtifactEffectiveReceiver,
  narrowArtifactScope,
} from "../cursor/artifact-mapper.js";
import { acceptOCDConflict } from "../cursor/ocd-evaluator.js";
import type { CursorHandoffArtifact, CursorOCDPolicy, CursorScopeQuestion } from "../cursor/types.js";
import type { CursorEditorPlugin }   from "../cursor/delivery-gate.js";
import type { FsChange, ReplaceChange } from "../understand/interpretation/types.js";
import { isFsChange }               from "../understand/interpretation/types.js";
import {
  bindEffectiveFsChange,
  bindOnePath,
  bindReplaceChange,
  EFFECTIVE_RESOURCE_UNRESOLVED_MSG,
} from "../input/effective-resource.js";
import type { FsPlugin }              from "../workflow/types.js";
import { ensureUcpIntentRoot } from "../ucp/ensure-intent-root.js";
import { resolveStoreDir } from "../shell/defaults.js";

// ─── Session phases ───────────────────────────────────────────────────────────

export type SessionPhase =
  | "idle"           // no input submitted
  | "not_execute"    // intake ran, mode ≠ execute (guide / clarify / refuse / ignore)
  | "intake_failed"  // unexpected error during intake
  | "prepared"       // OCD cleared, awaiting H approval
  | "conflict"       // OCD detected a conflict, H must act before approval
  | "approved"       // H approved, ready to deliver
  | "scope_question" // Cursor asked for scope clarification
  | "accepted"       // edit applied on disk
  | "exec_error"     // Cursor returned an execution error
  | "blocked"        // gate blocked (ineligible or persistence failure)
  | "rejected";      // H rejected (or explicit rejection after scope_question)

// ─── Session state ────────────────────────────────────────────────────────────

export type CursorSessionState = {
  readonly phase: SessionPhase;

  // Input
  readonly input?: string;
  readonly parsedChange?: ReplaceChange;

  /**
   * Deterministic filesystem operation parsed from structured NL input.
   * Set when the interactive REPL (or submit) detects an FsChange via
   * parseChange(). Executed via FsPlugin.executeFsOp — never stuffed
   * into parsedChange or the replace artifact path.
   */
  readonly fsOp?: FsChange;

  /**
   * Workspace used to stamp receiver identity at prepare / scope-answer.
   * Not an authority field. Absent when the session was built without a root.
   */
  readonly workspaceRoot?: string;

  // Intake provenance
  readonly intentId?: string;
  readonly responseId?: string;

  // Current artifact (updated as H interacts)
  readonly artifact?: CursorHandoffArtifact;

  // Preparation result (for display)
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

  // Scope question from Cursor (set when phase === "scope_question")
  readonly scopeQuestion?: CursorScopeQuestion;

  // Execution result (set when phase is terminal execution outcome)
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

  // Phase-specific display text
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

// ─── Builders (exactOptionalPropertyTypes safe) ───────────────────────────────

/** Build a SessionDisplay, omitting keys whose value is absent. */
function mkDisplay(d: {
  headline:           string;
  changeSummary?:     string | undefined;
  targetFiles?:       readonly string[] | undefined;
  conflicts?:         readonly string[] | undefined;
  scopeCandidates?:   readonly string[] | undefined;
  resultNote?:        string | undefined;
}): SessionDisplay {
  return Object.fromEntries(
    Object.entries(d).filter(([, v]) => v !== undefined),
  ) as SessionDisplay;
}

type PartialSession = {
  [K in keyof CursorSessionState]?: CursorSessionState[K] | undefined;
} & { phase: SessionPhase; display: SessionDisplay };

/** Build a session state, omitting keys whose value is undefined. */
function mk(s: PartialSession): CursorSessionState {
  return Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined),
  ) as CursorSessionState;
}

// ─── Session factory ──────────────────────────────────────────────────────────

const INITIAL_STATE: CursorSessionState = {
  phase:   "idle",
  display: { headline: "Ready. Submit an edit command." },
};

/**
 * Create a new product session in the idle phase.
 */
export function createSession(): CursorSessionState {
  return INITIAL_STATE;
}

// ─── Guide mode renderer ─────────────────────────────────────────────────────

/**
 * Family-specific fallback next steps, shown when the deterministic nextSteps
 * list is empty but llmClassification is present.
 *
 * These are guidance rewrites only — they never trigger execution directly.
 */
const FAMILY_FALLBACK_STEPS: Record<string, readonly string[]> = {
  find:      ['Specify the exact path: replace "X" with "Y" in path/to/file',
               "Use rename, replace, or delete on a known file"],
  clean_up:  ["Use: delete file <path>  to remove a specific file",
               "Use: rename <old> to <new>  to move a file"],
  fix:       ['Use: replace "old text" with "new text" in <file>',
               "Specify which file contains the problem"],
  config:    ["Specify the config file and the value to change",
               'Example: replace "port: 3000" with "port: 8080" in config.json'],
  artifact:  ["Specify path and content: create file src/utils/helpers.ts",
               "Use: create file <path>"],
  boundary:  ['Example: replace "Submit" with "Continue" in src/Button.tsx',
               "Example: rename Button.tsx to PrimaryButton.tsx"],
};

/**
 * Zero-state examples — always shown if all other sources are empty.
 * Guarantees the user always sees at least one actionable format.
 *
 * Governance: lists every op in OPERATION_REGISTRY at least once.
 * tests/governance/input-surface-integrity.test.ts asserts this.
 */
const ZERO_STATE_STEPS: readonly string[] = [
  'replace "old text" with "new text" in <file>',
  'append "<text>" to <file>  |  prepend "<text>" to <file>',
  "rename <old-path> to <new-path>",
  "create file <path>  |  mkdir <path>  |  delete file <path>  |  run <command>",
];

/**
 * Translate internal slot / field names into human-readable questions.
 * Prevents terms like source_path, intent_family, or slots from leaking
 * into user-visible output.
 */
const SLOT_TO_QUESTION: Record<string, string> = {
  "source_path":     "Which file should this apply to?",
  "target_path":     "What should the new path or name be?",
  "intent_family":   "What type of change are you making?",
  "file path":       "Which file should this apply to?",
  "exact file path": "Which file should this apply to?",
  "exact path":      "Which file or folder path?",
  "target path":     "What should the new path or name be?",
  "target name":     "What should the new name be?",
  "commit message":  "What should the commit message say?",
  "command to run":  "Which command should be run?",
  "specific target": "Which specific file or operation?",
  "specific action": "Which operation: replace, rename, create, delete, or run?",
  "target":          "Which specific target (file, folder, or command)?",
  "current value":   "What is the current text to replace?",
  "new value":       "What should it be replaced with?",
  "search value":    "What text should be searched for?",
  "replace value":   "What should it be replaced with?",
  "exact target":    "Which specific file or value?",
  "specific change": "What exactly should change?",
};

function humanizeMissing(fields: readonly string[]): string {
  const q = SLOT_TO_QUESTION[fields[0]!.toLowerCase()]
         ?? SLOT_TO_QUESTION[fields[0]!]
         ?? `What is the ${fields[0]}?`;
  return q;
}

/** Human-readable summary for an FsChange approval surface (REPL + session). */
function fsOpSummary(op: FsChange): string {
  switch (op.operationType) {
    case "create_dir":   return `Create directory ${op.dirPath}`;
    case "write_file":   return `Create file ${op.filePath}`;
    case "append_file":  return `Append to ${op.filePath}`;
    case "prepend_file": return `Prepend to ${op.filePath}`;
    case "rename":       return `Rename ${op.filePath} → ${op.newPath}`;
    case "delete_file":  return `Delete ${op.filePath}`;
    case "run_command":  return `Run command "${op.command}"`;
  }
}

function fsOpTargetFiles(op: FsChange): readonly string[] {
  switch (op.operationType) {
    case "create_dir":   return [op.dirPath];
    case "write_file":
    case "append_file":
    case "prepend_file":
    case "delete_file":  return [op.filePath];
    case "rename":       return [op.filePath, op.newPath];
    case "run_command":  return [];
  }
}

function refusedBeforeApproval(
  input: string,
  message: string,
  workspaceRoot?: string,
): CursorSessionState {
  return mk({
    phase: "exec_error",
    input,
    ...(workspaceRoot !== undefined && workspaceRoot.length > 0 ? { workspaceRoot } : {}),
    display: mkDisplay({ headline: `${message} Refused before approval.` }),
  });
}

function buildFsPreparedState(
  input: string,
  fsOp:  FsChange,
  workspaceRoot: string,
): CursorSessionState {
  if (workspaceRoot.length === 0) {
    return refusedBeforeApproval(input, EFFECTIVE_RESOURCE_UNRESOLVED_MSG);
  }
  const bound = bindEffectiveFsChange(fsOp, workspaceRoot);
  if (!bound.ok) {
    return refusedBeforeApproval(input, bound.message, workspaceRoot);
  }
  const { ucpRootId } = ensureUcpIntentRoot(resolveStoreDir(), input);
  return mk({
    phase:      "prepared",
    input,
    fsOp:       bound.op,
    workspaceRoot,
    intentId:   ucpRootId,
    preparedAt: Date.now(),
    display:    mkDisplay({
      headline:      "Ready to apply.",
      changeSummary: fsOpSummary(bound.op),
      targetFiles:   fsOpTargetFiles(bound.op),
    }),
  });
}

function pluginSupportsFs(plugin: CursorEditorPlugin): plugin is CursorEditorPlugin & FsPlugin {
  return typeof (plugin as unknown as FsPlugin).executeFsOp === "function";
}

/**
 * Render a structured guide state from an IntakeResult in guide mode.
 *
 * Directive priority (first wins):
 *   1. Boundary mode → "This request is too broad to run safely."
 *   2. LLM suggested_rewrite  → "Try: <rewrite>"
 *   3. LLM clarification_question
 *   4. missing[] fields  → human-readable question (never internal terms)
 *   5. Generic fallback
 *
 * Steps priority (1–3, guaranteed non-empty):
 *   1. Deterministic nextSteps from the pipeline
 *   2. Family-specific fallback from llmClassification
 *   3. Zero-state examples (always shown when all else is empty)
 */
function buildGuideState(
  intakeResult: { mode: string; guidance?: GuidancePayload },
  input:        string,
  intentId:     string,
  responseId:   string,
): CursorSessionState {
  const g          = intakeResult.guidance;
  const llm        = g?.llmClassification;
  const isBoundary = g?.silentGuidanceMode === "boundary" || !!llm?.boundary_reason;

  // ── Primary directive ──────────────────────────────────────────────────────
  const headline =
    isBoundary
      ? "This request is too broad to run safely."
      : llm?.suggested_rewrite
      ? `Try: ${llm.suggested_rewrite}`
      : llm?.clarification_question
      ? llm.clarification_question
      : g?.missing?.length
      ? humanizeMissing(g.missing)
      : "Describe a specific file change — replace, rename, create, delete, or run.";

  // ── Next steps (1–3, never empty, deduplicated) ───────────────────────────
  const deterministicSteps = (g?.nextSteps ?? [])
    .map(s => `→ ${s.label}`)
    .filter((s, i, arr) => arr.indexOf(s) === i)  // dedup by label
    .slice(0, 3);
  const fallbackSteps: string[] =
    deterministicSteps.length === 0 && llm !== undefined
      ? (FAMILY_FALLBACK_STEPS[llm.intent_family] ?? []).slice(0, 2).map(s => `→ ${s}`)
      : [];
  const rawSteps = deterministicSteps.length > 0 ? deterministicSteps : fallbackSteps;
  const steps    = rawSteps.length > 0 ? rawSteps : ZERO_STATE_STEPS.map(s => `→ ${s}`);

  // ── Build changeSummary: optional boundary sub-line + labelled steps ───────
  const boundaryLine  = isBoundary ? "Break it into a specific file change.\n" : "";
  const changeSummary = `${boundaryLine}Try one of these:\n${steps.join("\n")}`;

  return mk({
    phase: "not_execute", input, intentId, responseId,
    display: mkDisplay({ headline, changeSummary }),
  });
}

// ─── Session transitions ──────────────────────────────────────────────────────

/**
 * Submit user input. Runs intake + prepare. Returns next session state.
 *
 * @param input   The raw user text (e.g. "change button color to red").
 * @param policy  OCD policy for the workspace.
 */
export function submit(
  state:  CursorSessionState,
  input:  string,
  policy: CursorOCDPolicy,
  precomputedPc?: ReplaceChange,
): CursorSessionState {
  // Terminal sessions are immutable — caller must create a new session.
  if (isTerminal(state)) return state;

  // FS fast path — deterministic primitives bypass intake (parity with the
  // workflow coordinator's currentFsOp path and the FsChange contract in
  // understand/interpretation/types.ts).
  const earlyRaw = precomputedPc ?? (parseChange(input) ?? undefined);
  if (earlyRaw && isFsChange(earlyRaw)) {
    return buildFsPreparedState(input, earlyRaw, policy.workspaceRoot);
  }

  // Run intake
  let ucpResult;
  try {
    ucpResult = runIntakeWithUCP(input, {
      prvContext:          { hasPriorSession: false },
      interactionContract: DEFAULT_CONTRACT,
    });
  } catch (err) {
    return mk({ phase: "intake_failed", input, display: mkDisplay({ headline: `Intake error: ${String(err)}` }) });
  }

  const { result: intakeResult, ucp } = ucpResult;
  const intentId   = ucp.intent.id;
  const responseId = ucp.response.id;

  // Family-level observability: fire-and-forget, never blocks execution.
  phCapture("intake_result", {
    mode:                     intakeResult.mode,
    silent_guidance_mode:     intakeResult.guidance?.silentGuidanceMode ?? null,
    has_bridge_interpretation: intakeResult.guidance?.interpretation !== undefined,
    llm_enriched:             false,
    llm_family:               null,
    llm_confidence:           null,
  });

  // Not an execute flow — surface mode for the consumer
  if (intakeResult.mode !== "execute") {
    // Both guide and clarify lead to the same user-facing outcome: actionable guidance.
    if (intakeResult.mode === "guide" || intakeResult.mode === "clarify") {
      return buildGuideState(intakeResult, input, intentId, responseId);
    }
    const modeDisplay: Record<string, string> = {
      refuse:  "Input refused — unsafe or out of scope.",
      ignore:  "Input does not require action.",
    };
    return mk({
      phase: "not_execute", input, intentId, responseId,
      display: mkDisplay({ headline: modeDisplay[intakeResult.mode] ?? `Mode: ${intakeResult.mode}` }),
    });
  }

  // Parse change for structured replace commands (FsChange handled above).
  const rawPc = precomputedPc ?? (parseChange(input) ?? undefined);
  let pc: ReplaceChange | undefined =
    rawPc && !isFsChange(rawPc) ? rawPc : undefined;
  if (pc !== undefined) {
    if (policy.workspaceRoot.length === 0 && pc.filePath !== undefined) {
      return refusedBeforeApproval(input, EFFECTIVE_RESOURCE_UNRESOLVED_MSG);
    }
    if (policy.workspaceRoot.length > 0) {
      const bound = bindReplaceChange(pc, policy.workspaceRoot);
      if (!bound.ok) return refusedBeforeApproval(input, bound.message, policy.workspaceRoot);
      pc = bound.parsed;
    }
  }

  // Prepare
  const prepResult = prepareCursorExecution(intakeResult, intentId, responseId, policy, pc);

  if (prepResult.kind === "not_execute") {
    return mk({ phase: "not_execute", input, intentId, responseId, display: mkDisplay({ headline: prepResult.reason }) });
  }

  const nextPhase: SessionPhase = prepResult.kind === "conflict_detected" ? "conflict" : "prepared";

  return mk({
    phase: nextPhase,
    input,
    ...(pc !== undefined ? { parsedChange: pc } : {}),
    ...(policy.workspaceRoot.length > 0 ? { workspaceRoot: policy.workspaceRoot } : {}),
    intentId,
    responseId,
    preparedAt:   Date.now(),
    artifact:     prepResult.artifact,
    prepResult,
    presentHints: prepResult.presentHints,
    display:      mkDisplay({
      headline:      prepResult.display.headline,
      changeSummary: prepResult.display.summary,
      ...(prepResult.display.targetFile ? { targetFiles: [prepResult.display.targetFile] } : {}),
      conflicts:     [...prepResult.display.conflicts],
    }),
  });
}

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
export async function submitAsync(
  state:  CursorSessionState,
  input:  string,
  policy: CursorOCDPolicy,
): Promise<CursorSessionState> {
  if (isTerminal(state)) return state;

  const earlyRaw = parseChange(input) ?? undefined;
  if (earlyRaw && isFsChange(earlyRaw)) {
    return buildFsPreparedState(input, earlyRaw, policy.workspaceRoot);
  }

  let ucpResult;
  try {
    ucpResult = runIntakeWithUCP(input, {
      prvContext:          { hasPriorSession: false },
      interactionContract: DEFAULT_CONTRACT,
    });
  } catch (err) {
    return mk({ phase: "intake_failed", input, display: mkDisplay({ headline: `Intake error: ${String(err)}` }) });
  }

  const { ucp } = ucpResult;
  const intentId   = ucp.intent.id;
  const responseId = ucp.response.id;

  // Enrich guide mode results with LLM classification.
  const intakeResult = await runIntakeWithLLM(input, {
    prvContext:          { hasPriorSession: false },
    interactionContract: DEFAULT_CONTRACT,
  });

  // Family-level observability (async path — includes LLM enrichment data).
  phCapture("intake_result", {
    mode:                     intakeResult.mode,
    silent_guidance_mode:     intakeResult.guidance?.silentGuidanceMode ?? null,
    has_bridge_interpretation: intakeResult.guidance?.interpretation !== undefined,
    llm_enriched:             intakeResult.guidance?.llmClassification !== undefined,
    llm_family:               intakeResult.guidance?.llmClassification?.intent_family ?? null,
    llm_confidence:           intakeResult.guidance?.llmClassification?.confidence    ?? null,
  });

  if (intakeResult.mode !== "execute") {
    if (intakeResult.mode === "guide" || intakeResult.mode === "clarify") {
      return buildGuideState(intakeResult, input, intentId, responseId);
    }
    const modeDisplay: Record<string, string> = {
      refuse: "Input refused — unsafe or out of scope.",
      ignore: "Input does not require action.",
    };
    return mk({
      phase: "not_execute", input, intentId, responseId,
      display: mkDisplay({ headline: modeDisplay[intakeResult.mode] ?? `Mode: ${intakeResult.mode}` }),
    });
  }

  const rawPc = parseChange(input) ?? undefined;
  let pc: ReplaceChange | undefined =
    rawPc && !isFsChange(rawPc) ? rawPc : undefined;
  if (pc !== undefined) {
    if (policy.workspaceRoot.length === 0 && pc.filePath !== undefined) {
      return refusedBeforeApproval(input, EFFECTIVE_RESOURCE_UNRESOLVED_MSG);
    }
    if (policy.workspaceRoot.length > 0) {
      const bound = bindReplaceChange(pc, policy.workspaceRoot);
      if (!bound.ok) return refusedBeforeApproval(input, bound.message, policy.workspaceRoot);
      pc = bound.parsed;
    }
  }

  const prepResult = prepareCursorExecution(intakeResult, intentId, responseId, policy, pc);
  if (prepResult.kind === "not_execute") {
    return mk({ phase: "not_execute", input, intentId, responseId, display: mkDisplay({ headline: prepResult.reason }) });
  }

  const nextPhase: SessionPhase = prepResult.kind === "conflict_detected" ? "conflict" : "prepared";
  return mk({
    phase: nextPhase,
    input,
    ...(pc !== undefined ? { parsedChange: pc } : {}),
    ...(policy.workspaceRoot.length > 0 ? { workspaceRoot: policy.workspaceRoot } : {}),
    intentId,
    responseId,
    preparedAt:   Date.now(),
    artifact:     prepResult.artifact,
    prepResult,
    presentHints: prepResult.presentHints,
    display:      mkDisplay({
      headline:      prepResult.display.headline,
      changeSummary: prepResult.display.summary,
      ...(prepResult.display.targetFile ? { targetFiles: [prepResult.display.targetFile] } : {}),
      conflicts:     [...prepResult.display.conflicts],
    }),
  });
}

/**
 * H approves the prepared artifact. Transitions to "approved".
 * Only valid from "prepared" phase.
 */
export function approve(
  state: CursorSessionState,
  at:    number = Date.now(),
): CursorSessionState {
  if (isTerminal(state)) return state;
  if (state.phase !== "prepared") {
    return invalidTransition(state, "approve", "prepared");
  }
  if (state.fsOp) {
    return mk({
      ...state,
      phase:   "approved",
      display: mkDisplay({ headline: "Approved. Ready to deliver.", changeSummary: state.display.changeSummary }),
    });
  }
  if (!state.artifact) {
    return invalidTransition(state, "approve", "prepared");
  }
  const approved = approveArtifact(state.artifact, at);
  return mk({
    ...state,
    phase:    "approved",
    artifact: approved,
    display:  mkDisplay({ headline: "Approved. Ready to deliver.", changeSummary: state.display.changeSummary }),
  });
}

/**
 * H accepts the OCD conflict. Transitions from "conflict" back to "prepared".
 */
export function acceptConflict(state: CursorSessionState): CursorSessionState {
  if (isTerminal(state)) return state;
  if (state.phase !== "conflict" || !state.artifact) {
    return invalidTransition(state, "acceptConflict", "conflict");
  }
  const accepted = acceptOCDConflict(state.artifact);
  // prepResult is now stale after conflict acceptance — artifact has moved forward.
  // The display is derived from the updated artifact.
  const { prepResult: _dropped, ...rest } = state;
  void _dropped;
  return mk({
    ...rest,
    phase:    "prepared",
    artifact: accepted,
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
export function narrow(
  state:        CursorSessionState,
  allowedFiles: readonly string[],
): CursorSessionState {
  if (isTerminal(state)) return state;
  if (
    (state.phase !== "prepared" && state.phase !== "scope_question")
    || !state.artifact
  ) {
    return invalidTransition(state, "narrow", "prepared | scope_question");
  }
  const narrowed = narrowArtifactScope(state.artifact, allowedFiles);
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
 * H answers a scope question by selecting a single candidate file.
 * The session narrows to that file and stamps a new pending binding.
 * Fresh approval is required — this does not re-approve.
 * Valid from "scope_question".
 */
export function answerScope(
  state: CursorSessionState,
  file:  string,
  at:    number = Date.now(),
  workspaceRoot?: string,
): CursorSessionState {
  if (isTerminal(state)) return state;
  if (state.phase !== "scope_question" || !state.artifact) {
    return invalidTransition(state, "answerScope", "scope_question");
  }
  // S4 — answerScope must only select from the candidates Cursor surfaced.
  // The candidate list is the exact set Cursor found within the approved scope.
  // Choosing outside it would silently expand scope beyond what was reviewed.
  if (state.scopeQuestion && !state.scopeQuestion.candidates.includes(file)) {
    return invalidTransition(
      state,
      "answerScope",
      `scope_question (file must be one of: ${state.scopeQuestion.candidates.join(", ")})`,
    );
  }
  void at;
  const narrowed = narrowArtifactScope(state.artifact, [file]);
  const parsed = narrowed.changeSpec.parsedChange;
  if (parsed === undefined) {
    return refusedBeforeApproval(state.input ?? "", EFFECTIVE_RESOURCE_UNRESOLVED_MSG, workspaceRoot ?? state.workspaceRoot);
  }
  const root = (workspaceRoot !== undefined && workspaceRoot.length > 0)
    ? workspaceRoot
    : (state.workspaceRoot ?? "");
  const pathToBind = file;
  if (root.length === 0) {
    return refusedBeforeApproval(state.input ?? "", EFFECTIVE_RESOURCE_UNRESOLVED_MSG);
  }
  const bound = bindOnePath(root, pathToBind);
  if (!bound.ok) {
    return refusedBeforeApproval(state.input ?? "", bound.message, root);
  }
  const pending = bindArtifactEffectiveReceiver(narrowed, bound.bind, pathToBind);
  if (pending.eligibility === "approved_for_cursor") {
    return refusedBeforeApproval(state.input ?? "", EFFECTIVE_RESOURCE_UNRESOLVED_MSG, root);
  }
  const { scopeQuestion: _answered, ...rest } = state;
  void _answered;
  return mk({
    ...rest,
    phase:         "prepared",
    artifact:      pending,
    parsedChange:  { ...parsed, filePath: pathToBind, approvedEffective: bound.bind },
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
export function reject(state: CursorSessionState): CursorSessionState {
  if (isTerminal(state)) return state;
  return mk({ ...state, phase: "rejected", display: mkDisplay({ headline: "Rejected.", changeSummary: state.display.changeSummary }) });
}

/**
 * Deliver the approved artifact through the execution gate.
 * Only valid from "approved" phase. Returns a terminal or "scope_question" state.
 *
 * @param plugin    The transport adapter (CursorInProcessAdapter for real edits).
 * @param storeDir  Absolute path to UCP store directory.
 * @param deps      Optional injectable persistence fns for testing.
 */
export async function deliver(
  state:    CursorSessionState,
  plugin:   CursorEditorPlugin,
  storeDir: string,
  deps?:    Parameters<typeof deliverCursorExecution>[3],
): Promise<CursorSessionState> {
  if (isTerminal(state)) return state;
  if (state.phase !== "approved") {
    return invalidTransition(state, "deliver", "approved");
  }

  if (state.fsOp) {
    if (!pluginSupportsFs(plugin)) {
      return mk({
        ...state,
        phase:   "exec_error",
        display: mkDisplay({
          headline:   "Filesystem plugin unavailable.",
          resultNote: "No executeFsOp implementation on the configured Cursor plugin.",
        }),
      });
    }
    const fsResult = await plugin.executeFsOp(state.fsOp);
    if (fsResult.kind === "accepted") {
      return mk({
        ...state,
        phase:   "accepted",
        display: mkDisplay({
          headline:      "Operation completed.",
          changeSummary: state.display.changeSummary,
          targetFiles:   state.display.targetFiles,
          resultNote:    fsOpSummary(state.fsOp),
        }),
      });
    }
    return mk({
      ...state,
      phase:   "exec_error",
      display: mkDisplay({
        headline:   "Execution failed.",
        resultNote: fsResult.detail ?? "Filesystem operation failed.",
      }),
    });
  }

  if (!state.artifact) {
    return invalidTransition(state, "deliver", "approved");
  }

  const result = await deliverCursorExecution(state.artifact, plugin, storeDir, deps);

  switch (result.kind) {
    case "accepted":
      return mk({
        ...state,
        phase:           "accepted",
        executionResult: result,
        display:         mkDisplay({
          headline:      "Edit applied.",
          changeSummary: state.display.changeSummary,
          targetFiles:   state.display.targetFiles,
          resultNote:    result.display.headline,
        }),
      });

    case "refused_due_to_scope":
      return mk({
        ...state,
        phase:           "scope_question",
        scopeQuestion:   result.scopeQuestion,
        executionResult: result,
        display:         mkDisplay({
          headline:        "Cursor needs scope clarification.",
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
        display:         mkDisplay({ headline: result.display.headline, resultNote: result.detail }),
      });

    case "blocked_ineligible":
    case "blocked_persistence_failure": {
      const note = result.display.note ?? undefined;
      return mk({
        ...state,
        phase:           "blocked",
        executionResult: result,
        display:         mkDisplay({ headline: result.display.headline, ...(note ? { resultNote: note } : {}) }),
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the session is in a terminal phase (no further transitions). */
export function isTerminal(state: CursorSessionState): boolean {
  return (
    state.phase === "accepted"     ||
    state.phase === "rejected"     ||
    state.phase === "exec_error"   ||
    state.phase === "blocked"      ||
    state.phase === "not_execute"  ||
    state.phase === "intake_failed"
  );
}

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
export function getPresentHints(state: CursorSessionState): {
  policyHint:       { readonly prohibitedGlobs: readonly string[] } | undefined;
  parsedChangeHint: { readonly filePath?: string } | undefined;
} {
  if (!state.presentHints) {
    return { policyHint: undefined, parsedChangeHint: undefined };
  }
  const { prohibitedGlobs, parsedChangeFilePath } = state.presentHints;
  return {
    policyHint:       { prohibitedGlobs },
    parsedChangeHint: parsedChangeFilePath !== undefined ? { filePath: parsedChangeFilePath } : undefined,
  };
}

/** Returns true if the session accepted and applied an edit. */
export function isAccepted(state: CursorSessionState): boolean {
  return state.phase === "accepted";
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function invalidTransition(
  state:    CursorSessionState,
  method:   string,
  expected: string,
): CursorSessionState {
  return mk({
    ...state,
    phase:   "blocked",
    display: mkDisplay({
      headline:   `Invalid transition: ${method}() called from phase "${state.phase}" (expected: ${expected}).`,
      resultNote: "Session is now blocked. Create a new session to continue.",
    }),
  });
}
