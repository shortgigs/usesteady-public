/**
 * IsolatedIntent — the semantic object that must exist before classification.
 *
 * Charter:  docs/product/USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1.md
 *           (INV-GI-1..INV-GI-7)
 * Doctrine: docs/reports/USESTEADY_WORKPLAN_GOAL_ISOLATION_V1.md §7 (frozen)
 *
 * The object partitions one confirmed raw input into exactly ONE goal span and
 * N categorized non-goal spans. Every span is a verbatim substring of the
 * original text at its recorded offsets — nothing invented, nothing dropped
 * (§7.2 total-coverage / no-loss). There is deliberately NO way to construct a
 * whole-blob IsolatedIntent: "could not isolate a goal" is `null` at the
 * proposer seam, never a fabricated object (§7.2 guarantee 1).
 *
 * Authority: NONE. This is a candidate-understanding artifact (frozen product
 * architecture, AI position 1). It becomes consumable by planning only after
 * an explicit human ratification carries it forward (INV-GI-6); the type
 * itself cannot express approval or execution.
 */

/** Non-goal span categories (report §7.1). */
export type IntentSegmentCategory =
  | "context"
  | "evidence"
  | "instruction"
  | "example"
  | "constraint";

/** One contiguous verbatim span of the original input. */
export type IntentSpan = {
  /** Verbatim substring — always equals `rawInput.slice(start, end)`. */
  readonly text: string;
  /** Inclusive start offset into the original raw input. */
  readonly start: number;
  /** Exclusive end offset into the original raw input. */
  readonly end: number;
};

/** A categorized non-goal span. */
export type IsolatedIntentSegment = IntentSpan & {
  readonly category: IntentSegmentCategory;
};

/**
 * Replayable provenance back to the exact text the isolation was computed
 * from (report §7.1 `source`). Carrying the hash instead of the text keeps
 * the artifact small while making any drift detectable.
 */
export type IsolatedIntentSource = {
  /** SHA-256 (hex) of the verbatim raw input string. */
  readonly rawInputSha256: string;
  /** Length of the raw input in UTF-16 code units (offset domain). */
  readonly length: number;
};

/**
 * Who produced this reading. Runtime metadata only — never vendor or model
 * branding (frozen architecture binding rule 2 / agent-provenance).
 */
export type IsolatedIntentProposedBy = "model" | "human_revision";

/**
 * The isolated-intent artifact (report §7.1). Exactly one goal; segments cover
 * everything else; whitespace between spans is the only text allowed to be
 * uncovered.
 */
export type IsolatedIntent = {
  readonly goal: IntentSpan;
  readonly segments: readonly IsolatedIntentSegment[];
  readonly source: IsolatedIntentSource;
  readonly proposedBy: IsolatedIntentProposedBy;
};

export const INTENT_SEGMENT_CATEGORIES: readonly IntentSegmentCategory[] = [
  "context",
  "evidence",
  "instruction",
  "example",
  "constraint",
];
