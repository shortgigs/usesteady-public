/**
 * Presentation layer types.
 *
 * PresentationOutput is the last mile before the consumer renders something.
 * It is pure data — no HTML, no colour codes, no terminal escapes.
 *
 * This layer sits entirely above the intake pipeline.
 * It takes an IntakeResult and formats it into consumer-friendly fields.
 *
 * CONTRACT: formatIntakeResult is deterministic.
 * Same IntakeResult → same PresentationOutput, always.
 *
 * CONTRACT: This layer adds no new decisions.
 * Every field in PresentationOutput is derived from existing IntakeResult fields.
 * It never re-runs intake, completion, or interpretation.
 */

import type { ResponseMode } from "../intake/types.js";
import type { DebugTrace }   from "../intake/trace.js";
import type { BoundaryExplanation } from "./boundary-explanation/boundary-explanation-types.js";

export type PresentationOutput = {
  /**
   * Mode badge — the display label for the response mode.
   * Consumers can render this as a chip, badge, or prefix.
   * Values: "REFUSE" | "IGNORE" | "CLARIFY" | "GUIDE" | "EXECUTE"
   */
  readonly mode: ResponseMode;
  readonly badge: string;

  /**
   * Headline — the first sentence a consumer would show the user.
   *
   * For guide mode with interpretation: the interpretation summary
   *   ("This appears to be a color/style change request.")
   * For guide mode without interpretation: the completion reason
   *   ("A commit message is required.")
   * For execute mode with change interpretation: the interpretation summary
   *   ("Changes background color from 'bg-blue-500' to 'bg-red-500'.")
   * For all other modes: the system reason
   */
  readonly headline: string;

  /**
   * Category — human-readable display name for the interpretation category.
   * Only present when interpretation is available (either family).
   * Examples: "Color / style change", "Tailwind color change", "Text / copy change"
   */
  readonly category?: string;

  /**
   * Confidence — human-readable confidence label.
   * Only present when interpretation is available.
   * Examples: "High confidence", "Medium confidence", "Low confidence"
   */
  readonly confidence?: string;

  /**
   * Steps — the formatted next-step labels from guidance.nextSteps.
   * Only present when mode === "guide".
   */
  readonly steps?: ReadonlyArray<string>;

  /**
   * Missing — the list of missing fields from guidance.missing.
   * Only present when mode === "guide".
   */
  readonly missing?: ReadonlyArray<string>;

  /**
   * certaintyLevel — answers the human question:
   * "Is this telling me what WILL happen, or what MIGHT be happening?"
   *
   *   "certain"  — execute + structured change interpretation
   *                The system knows exactly what this change means.
   *                Evidence: a deterministic patch command was parsed.
   *
   *   "inferred" — guide + intent interpretation
   *                The system has a reasonable signal about the intent.
   *                Evidence: color/text/config words matched in the input.
   *                Not confirmed until the user provides an exact format.
   *
   *   "unknown"  — no interpretation of either kind
   *                The system made a decision but has no meaning layer.
   *                Examples: refuse (no interpretation warranted),
   *                          incomplete guide (intent clear, not meaning),
   *                          execute with no parseable structure.
   *
   * This field is purely derived — no logic authority.
   * It changes nothing about what the system will do.
   */
  readonly certaintyLevel: "certain" | "inferred" | "unknown";

  /**
   * debugTrace — the raw pipeline trace for observability.
   *
   * Only present when formatIntakeResult is called with a DebugTrace
   * (i.e. when using runIntakeWithTrace). Absent in normal production output.
   *
   * Zero authority: this field has no effect on what the system does.
   * It is purely informational — a window into what fired, why, and where
   * the pipeline terminated.
   *
   * Useful for:
   *   - Debugging unexpected mode decisions
   *   - Verifying that bridgeFired matches expectation
   *   - Confirming which gate terminated the pipeline early
   *   - Developer tooling and trust audits
   */
  readonly debugTrace?: DebugTrace;

  /**
   * boundaryExplanation — Phase 5C metadata.
   *
   * Present when the system detected a correct-but-confusing routing decision
   * that benefits from an explicit human-readable explanation.
   *
   * Absent when no boundary was detected.
   * Never null. Never stacks (exactly one or absent).
   * Zero authority: this field explains, never routes or overrides.
   */
  readonly boundaryExplanation?: BoundaryExplanation;
};
