/**
 * Intake pipeline types.
 *
 * ── Signal contract ───────────────────────────────────────────────────────────
 *
 *   IntakeSignal is the PUBLIC output signal.
 *   It does NOT include `unknown` from disambiguation — that is an internal
 *   intermediate state meaning "no ambiguity detected; fall through to completion."
 *
 * ── Dual interpretation contract ──────────────────────────────────────────────
 *
 *   IntakeResult carries two distinct, independent interpretation fields:
 *
 *   guidance.interpretation (IntentInterpretation)
 *     → Present when mode === "guide" AND vague intent was classified
 *     → Describes what the user appears to be TRYING TO DO
 *     → Produced by Intent Interpretation Bridge (understand/intent-interpretation/)
 *
 *   interpretation (InterpretationResult)
 *     → Present when mode === "execute" AND input is a structured change command
 *     → Describes what the change MEANS (impact, confidence, category)
 *     → Produced by Change Interpretation (understand/interpretation/)
 *
 * ── Guide mode contract ───────────────────────────────────────────────────────
 *
 *   When mode === "guide", IntakeResult MUST carry `guidance`.
 *   No consumer should need to recompute completion to get next steps.
 */

import type { PRVContext } from "../prv/types.js";
import type { InteractionContract } from "../interaction/types.js";
import type { InterpretationResult } from "../understand/interpretation/types.js";

// GuidancePayload lives in intent-interpretation — it owns the enriched form.
export type { GuidancePayload } from "../understand/intent-interpretation/types.js";

// ─── Signals (public output only) ─────────────────────────────────────────────

export type IntakeSignal =
  | { readonly type: "unsafe";          readonly source: "safety" }
  | { readonly type: "non_literal";     readonly source: "context" }
  | { readonly type: "hard_mismatch";   readonly source: "context" }
  | { readonly type: "ambiguous";       readonly source: "disambiguation" }
  | { readonly type: "incomplete";      readonly source: "completion" }
  | { readonly type: "guided_recovery"; readonly source: "completion" }
  | { readonly type: "complete";        readonly source: "completion" };

// ─── Intent states ────────────────────────────────────────────────────────────

export type IntentState =
  | "unsafe"
  | "non_literal"
  | "ambiguous"
  | "incomplete"       // completion: intent clear, required field missing
  | "guided_recovery"  // completion: intent vague, safe next steps available
  | "clear";

// ─── Response modes ───────────────────────────────────────────────────────────

export type ResponseMode =
  | "refuse"   // unsafe → no action, explicit refusal
  | "ignore"   // non_literal → acknowledge but do not process as task
  | "clarify"  // ambiguous or hard_mismatch → ask for clarification
  | "guide"    // incomplete or guided_recovery → provide next steps
  | "execute"; // clear → ready to execute

// ─── Intake context ───────────────────────────────────────────────────────────

export type IntakeContext = {
  readonly prvContext: PRVContext;
  readonly interactionContract: InteractionContract;
};

// ─── Intake result ────────────────────────────────────────────────────────────

import type { GuidancePayload } from "../understand/intent-interpretation/types.js";

export type IntakeResult = {
  readonly mode: ResponseMode;
  readonly reason: string;
  readonly signal: IntakeSignal;
  readonly intentState: IntentState;
  readonly guidance?: GuidancePayload;
  readonly interpretation?: InterpretationResult;
  // CONTRACT: guidance present iff mode === "guide"
  // CONTRACT: guidance.interpretation present when mode === "guide" AND vague intent classified
  // CONTRACT: interpretation present when mode === "execute" AND structured change command in scope
  // Both interpretations are ADVISORY — neither affects the mode decision.
};
