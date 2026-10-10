/**
 * Present Coordinator — Phase 5, Present Layer integration path.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * A single consumer entry point that:
 *   1. Tries reminder presentation if the raw input has a reminder signal.
 *   2. Falls back to standard intake presentation if no reminder signal is found.
 *
 * Consumers receive a PresentResult discriminated union and route based on kind.
 * The coordinator owns selection. The consumer owns rendering and routing.
 *
 * ── Why a coordinator? ────────────────────────────────────────────────────────
 *
 * The existing formatIntakeResult receives only IntakeResult — it does not see
 * the raw input. Reminder detection requires the raw input (explicit signal
 * matching). The coordinator is the narrow bridge that wires both without
 * mixing their concerns.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 *
 *   NOT an execution layer        — never schedules, stores, or triggers
 *   NOT an intake modification    — the intake pipeline result is used as-is
 *   NOT a decision authority      — all decisions came from upstream (intake)
 *   NOT an interpreter            — no new classification happens here
 *
 * ── Routing contract ─────────────────────────────────────────────────────────
 *
 *   Consumer calls presentFromInput(input, intakeResult, trace?).
 *   Consumer receives PresentResult.
 *   Consumer checks result.kind to route:
 *
 *     "reminder" → render with renderReminder(), check actions[].enabled
 *     "intake"   → render with existing PresentationOutput fields
 *
 *   Routing logic lives in the consumer, not here.
 *
 * ── Priority rule ─────────────────────────────────────────────────────────────
 *
 *   If the input contains a reminder signal → return kind: "reminder".
 *   Otherwise → return kind: "intake".
 *
 *   This priority is intentional:
 *   - Reminder signal is explicit ("remind me", "set a reminder", etc.)
 *   - If the signal is present, reminder shaping is always more useful than
 *     a generic guide/execute presentation.
 *   - The intake result is still available inside PresentResult for consumers
 *     who need it alongside the reminder presentation.
 *
 * ── Future-safety ─────────────────────────────────────────────────────────────
 *
 *   When real reminder execution exists, consumers update their routing:
 *     On confirm (enabled) → call execution layer.
 *   The Present Layer itself never changes for that.
 *   PresentResult remains correct.
 */

import type { IntakeResult } from "../intake/types.js";
import type { DebugTrace }   from "../intake/trace.js";
import type { PresentationOutput } from "./types.js";
import type { ReminderPresentation } from "./reminders/reminder-types.js";
import { formatIntakeResult } from "./format.js";
import { presentReminder }    from "./reminders/reminder-presenter.js";
import {
  evaluateControlVisibility,
  assertControlVisibilityConsistency,
} from "./control-visibility/index.js";
import {
  detectBoundaryExplanation,
  detectReminderBoundaryExplanation,
} from "./boundary-explanation/index.js";
import { matchesGlob } from "../cursor/glob-matcher.js";

// ─── 5D policy check types (minimal interface, no full cursor dependency) ────

/**
 * Minimal policy information needed for 5D cross-layer contradiction detection.
 * Callers pass this when they have policy context available.
 */
export type PolicyHint = {
  readonly prohibitedGlobs: readonly string[];
};

/**
 * Minimal parsed-change shape needed for 5D target-path checks.
 */
export type ParsedChangeHint = {
  readonly filePath?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// PresentResult — the discriminated union consumers route on
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PresentResult — what presentFromInput() returns.
 *
 * Discriminate on `kind`:
 *
 *   "reminder" — input contained a reminder signal.
 *                presentation is a ReminderPresentation.
 *                Check presentation.state for completeness.
 *                Check presentation.actions[].enabled before routing confirm.
 *                intakeResult is included for consumers who need both.
 *
 *   "intake"   — no reminder signal found, or reminder detection returned null.
 *                presentation is a standard PresentationOutput from formatIntakeResult.
 *                Existing rendering logic applies.
 */
export type PresentResult =
  | {
      readonly kind:         "reminder";
      readonly presentation: ReminderPresentation;
      readonly intakeResult: IntakeResult;
      readonly trace?:       DebugTrace;
    }
  | {
      readonly kind:         "intake";
      readonly presentation: PresentationOutput;
      readonly intakeResult: IntakeResult;
      readonly trace?:       DebugTrace;
    };

// ─────────────────────────────────────────────────────────────────────────────
// presentFromInput — the single consumer entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Present the result of running an intake pipeline on the given input.
 *
 * @param input        The raw input string (same one that was passed to intake).
 * @param intakeResult The result of runIntake / runIntakeWithTrace.
 * @param trace        Optional debug trace from runIntakeWithTrace.
 *
 * Returns a PresentResult discriminated union.
 *
 * ── Selection logic ──────────────────────────────────────────────────────────
 *
 *   1. Try presentReminder(input).
 *      If non-null → return { kind: "reminder", presentation }.
 *   2. Otherwise → return { kind: "intake", presentation: formatIntakeResult(...) }.
 *
 * ── What consumers do with it ────────────────────────────────────────────────
 *
 *   if (result.kind === "reminder") {
 *     // Use result.presentation (ReminderPresentation)
 *     const rendered = renderReminder(result.presentation);
 *     // Check result.presentation.actions.find(a => a.id === "confirm")?.enabled
 *     // Show rendered.prompt when state !== "ready_to_confirm"
 *   } else {
 *     // Use result.presentation (PresentationOutput)
 *     // Existing rendering path
 *   }
 *
 * ── Determinism guarantee ────────────────────────────────────────────────────
 *
 *   Same inputs → same output, always.
 *   No session state. No side effects. No randomness.
 */
export function presentFromInput(
  input:         string,
  intakeResult:  IntakeResult,
  trace?:        DebugTrace,
  policy?:       PolicyHint,
  parsedChange?: ParsedChangeHint,
): PresentResult {
  const traceField = trace !== undefined ? { trace } : {};

  // ── Try reminder presentation first ───────────────────────────────────────
  const reminderPresentation = presentReminder(input);
  if (reminderPresentation !== null) {
    // 5C: attach boundary explanation for reminder path
    const reminderBoundary = detectReminderBoundaryExplanation(reminderPresentation);
    const enrichedReminder: ReminderPresentation = reminderBoundary
      ? { ...reminderPresentation, boundaryExplanation: reminderBoundary }
      : reminderPresentation;

    // CVG read-only hook — compute and assert, output shape unchanged.
    const cvg = evaluateControlVisibility({
      kind: "reminder_presentation",
      presentation: enrichedReminder,
    });
    assertControlVisibilityConsistency(cvg);

    return {
      kind:         "reminder",
      presentation: enrichedReminder,
      intakeResult,
      ...traceField,
    };
  }

  // ── Fall back to standard intake presentation ─────────────────────────────
  const basePresentation = formatIntakeResult(intakeResult, trace);

  // 5C: detect boundary explanation (first-match-wins)
  let intakeBoundary = detectBoundaryExplanation(input, intakeResult, trace);

  // 5D: cross-layer contradiction detection (only when policy + parsedChange provided)
  const hasContradiction = detectContradiction(intakeResult, policy, parsedChange);
  if (hasContradiction) {
    // policy_may_block_target overrides 5C boundary when 5D fires
    intakeBoundary = {
      code: "policy_may_block_target",
      message:
        "This change is structurally executable, but the target file may be restricted by policy. Review the target before approving.",
    };
  }

  // Attach boundary explanation when detected
  const intakePresentation: PresentationOutput = intakeBoundary
    ? { ...basePresentation, boundaryExplanation: intakeBoundary }
    : basePresentation;

  // CVG read-only hook — use provisionally_executable arm when contradiction detected
  const cvgInput = hasContradiction
    ? { kind: "intake_provisionally_executable" as const, presentation: intakePresentation }
    : { kind: "intake_presentation" as const,             presentation: intakePresentation };
  const cvg = evaluateControlVisibility(cvgInput);
  assertControlVisibilityConsistency(cvg);

  return {
    kind:         "intake",
    presentation: intakePresentation,
    intakeResult,
    ...traceField,
  };
}

// ─── 5D contradiction detection ──────────────────────────────────────────────

/**
 * Returns true when the intake result is "execute" but the parsedChange.filePath
 * matches a prohibited glob in the policy — indicating a likely downstream gate block.
 *
 * Pure function. No side effects. No external calls.
 * Only runs when both policy and parsedChange are provided.
 */
function detectContradiction(
  intakeResult:  IntakeResult,
  policy?:       PolicyHint,
  parsedChange?: ParsedChangeHint,
): boolean {
  if (!policy || !parsedChange) return false;
  if (intakeResult.mode !== "execute") return false;
  const filePath = parsedChange.filePath;
  if (!filePath) return false;
  return policy.prohibitedGlobs.some(glob => matchesGlob(filePath, glob));
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumer routing helpers — zero-authority, purely derived
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the reminder presentation is complete and confirmable.
 *
 * Consumers should use this before showing a confirm button as active.
 * If false, the confirm action's enabled flag will also be false —
 * but this helper makes the check explicit and readable.
 *
 * Zero authority: this function never changes what will happen.
 * It only describes the current presentation state.
 */
export function isReminderConfirmable(result: PresentResult): boolean {
  return (
    result.kind === "reminder" &&
    result.presentation.state === "ready_to_confirm"
  );
}

/**
 * Returns the clarification prompt for the current reminder state, or null.
 *
 * Useful when consumers want to display a contextual question to the user
 * without importing and calling renderReminder themselves.
 *
 * Returns null for non-reminder results and for ready_to_confirm (no prompt needed).
 */
export function getReminderPrompt(result: PresentResult): string | null {
  if (result.kind !== "reminder") return null;

  const { state, subject, time_text } = result.presentation;
  if (state === "ready_to_confirm") return null;

  if (state === "needs_time")    return "When should this reminder trigger?";
  if (state === "needs_subject") return "What should this reminder be for?";

  // ambiguous
  // Preserve the ambiguity honestly — don't overclaim what's missing
  const hasSubject = subject !== null;
  const hasTime    = time_text !== null;
  if (hasSubject && !hasTime) return "When should this reminder trigger?";
  if (hasTime && !hasSubject) return "What should this reminder be for?";
  return "Is this a reminder? If so, what would you like to be reminded about, and when?";
}
