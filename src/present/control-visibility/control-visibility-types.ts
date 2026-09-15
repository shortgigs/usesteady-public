/**
 * Control Visibility & Boundary Integrity (CVG) — Phase 5B types.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   A PRESENTATION-LAYER safety contract. Not a UI concern.
 *
 *   Higher-authority signals MUST dominate lower-authority presentation.
 *   This module defines the types that make that rule programmable and testable.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT an execution authority — it reads state, never sets it
 *   NOT a UI styling concern   — no colors, no strings
 *   NOT a routing decision     — consumers route; CVG only characterizes
 *
 * ── Invariant ─────────────────────────────────────────────────────────────────
 *
 *   Every distinct signal produces a structurally distinct result.
 *   No two authority levels are visually or programmatically equivalent.
 *   Assertions enforce this at runtime.
 */

// ─── Signal level ─────────────────────────────────────────────────────────────

/**
 * ControlSignalLevel — the authority tier of a presentation signal.
 *
 *   "blocking"  — execution MUST NOT proceed. Confirm is disabled.
 *                 The state must be surfaced and differentiated.
 *                 Example: conflict_detected, refused_scope.
 *
 *   "attention" — execution should not proceed without user acknowledgment.
 *                 The state must be surfaced, but confirm is not hard-blocked.
 *                 Example: ambiguous.
 *
 *   "normal"    — execution may proceed. No blocking concern.
 *                 The state must still be distinguishable from higher levels.
 *                 Example: ready_to_confirm.
 *
 * Authority order: blocking > attention > normal.
 * A higher-level signal MUST NOT be treated as a lower one.
 */
export type ControlSignalLevel =
  | "normal"
  | "attention"
  | "blocking";

// ─── Signal identity ──────────────────────────────────────────────────────────

/**
 * ControlSignal — the semantic identity of the presentation state.
 *
 *   conflict_detected       — OCD policy conflict; H must resolve before proceeding.
 *   not_ready               — required fields are missing; input incomplete.
 *   ambiguous               — insufficient signal to determine intent.
 *   refused_scope           — Cursor refused: scope clarification required.
 *   refused_execution       — Cursor refused: execution-level error or system block.
 *   ready_to_confirm        — all conditions met; H may proceed.
 *   provisionally_executable — Phase 5D: structurally executable now, but a downstream
 *                              policy block is likely based on the target path.
 *                              level: attention. Does not hard-block confirm.
 *                              Must surface. Must differentiate from ready_to_confirm.
 */
export type ControlSignal =
  | "conflict_detected"
  | "not_ready"
  | "ambiguous"
  | "refused_scope"
  | "refused_execution"
  | "ready_to_confirm"
  | "provisionally_executable";

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * ControlVisibilityResult — the programmatic characterization of a presentation state.
 *
 *   level              — authority tier (blocking / attention / normal)
 *   signal             — semantic identity of the state
 *   must_block_confirm — true when the confirm action MUST be disabled
 *   must_surface       — true when the state MUST be shown to H (not hidden)
 *   must_differentiate — true when the state MUST be visually/structurally
 *                        distinct from all other levels (always true)
 *
 * Flag assignment by level:
 *
 *   blocking:  must_block_confirm=true,  must_surface=true,  must_differentiate=true
 *   attention: must_block_confirm=false, must_surface=true,  must_differentiate=true
 *   normal:    must_block_confirm=false, must_surface=false, must_differentiate=true
 */
export type ControlVisibilityResult = {
  readonly level:              ControlSignalLevel;
  readonly signal:             ControlSignal;
  readonly must_block_confirm: boolean;
  readonly must_surface:       boolean;
  readonly must_differentiate: boolean;
};

// ─── Input discriminated union ────────────────────────────────────────────────

import type { ReminderPresentation }  from "../reminders/reminder-types.js";
import type { PresentationOutput }    from "../types.js";
import type { CursorPreparationResult, CursorExecutionResult }
  from "../../execution/cursor/cursor-execution-coordinator.js";

/**
 * ControlVisibilityInput — the set of presentation shapes the evaluator accepts.
 *
 * Each arm carries the full shape; the evaluator reads only what it needs
 * and never calls upstream logic.
 *
 *   "reminder_presentation"          — a ReminderPresentation from presentReminder()
 *   "intake_presentation"            — a PresentationOutput from formatIntakeResult()
 *   "cursor_preparation"             — a CursorPreparationResult from prepareCursorExecution()
 *   "cursor_execution"               — a CursorExecutionResult from deliverCursorExecution()
 *   "intake_provisionally_executable" — Phase 5D: execute-mode presentation where a
 *                                       downstream policy block is likely. Signals
 *                                       "attention" without blocking confirm.
 */
export type ControlVisibilityInput =
  | { readonly kind: "reminder_presentation";           readonly presentation: ReminderPresentation }
  | { readonly kind: "intake_presentation";             readonly presentation: PresentationOutput }
  | { readonly kind: "cursor_preparation";              readonly result: CursorPreparationResult }
  | { readonly kind: "cursor_execution";                readonly result: CursorExecutionResult }
  | { readonly kind: "intake_provisionally_executable"; readonly presentation: PresentationOutput };
