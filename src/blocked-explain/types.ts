/**
 * Blocked-explain payload — AI_SEAMS_V1_REV_1 / USESTEADY_BLOCKED_EXPLAIN_REVISE_RERATIFY_V1 S1.
 *
 * Advisory only (INV-BER-2): plain-language reason + bounded next options.
 * Never SYSTEM WILL, never CERT, never execution.
 */

export const BLOCKED_EXPLAIN_FORMAT = "usesteady.blocked-explain.v1" as const;

/** Refuse codes in charter §6 (minimum) + over-cap companion. */
export const BLOCKED_EXPLAIN_REFUSE_CODES = [
  "candidate_plan_not_executable",
  "candidate_plan_external_only",
  "candidate_plan_over_cap",
  "handoff_not_executable",
  "approved_plan_hash_mismatch",
  "content_pin_failed",
] as const;

export type BlockedExplainRefuseCode =
  (typeof BLOCKED_EXPLAIN_REFUSE_CODES)[number];

/** Closed option enum — no free-form WILL. */
export const BLOCKED_EXPLAIN_OPTIONS = [
  "export_approved_plan",
  "change_the_plan",
  "start_new_work_item",
  "abandon",
  "retry_handoff",
] as const;

export type BlockedExplainOption = (typeof BLOCKED_EXPLAIN_OPTIONS)[number];

/** Closed reason keys — structural facts, not invented ops. */
export const BLOCKED_EXPLAIN_REASON_KEYS = [
  "external_only_plan",
  "not_routable_plan",
  "over_cap_plan",
  "handoff_not_derivable",
  "approved_hash_stale",
  "content_pin_refuse",
] as const;

export type BlockedExplainReasonKey =
  (typeof BLOCKED_EXPLAIN_REASON_KEYS)[number];

export type BlockedExplainPayload = {
  readonly format: typeof BLOCKED_EXPLAIN_FORMAT;
  /** INV-AI-2 / INV-BER-2 — candidates never truth. */
  readonly isCandidate: true;
  readonly refuseCode: BlockedExplainRefuseCode;
  readonly reasonKey: BlockedExplainReasonKey;
  /** Plain-language HUL for the operator. */
  readonly reasonHul: string;
  readonly options: readonly BlockedExplainOption[];
  /** Proposer runtime label when model enriched; null for static template. */
  readonly modelRuntime: string | null;
  /** true when payload came from static fail-closed template (INV-BER-7). */
  readonly fromStaticTemplate: boolean;
};

export type BlockedExplainContext = {
  readonly refuseCode: BlockedExplainRefuseCode;
  /** Optional structural facts for the model (never authority). */
  readonly structuralFacts?: readonly string[];
  /** Optional short goal / plan summary (advisory context only). */
  readonly planSummary?: string;
};

export function isBlockedExplainRefuseCode(
  value: unknown,
): value is BlockedExplainRefuseCode {
  return (
    typeof value === "string" &&
    (BLOCKED_EXPLAIN_REFUSE_CODES as readonly string[]).includes(value)
  );
}

export function isBlockedExplainOption(
  value: unknown,
): value is BlockedExplainOption {
  return (
    typeof value === "string" &&
    (BLOCKED_EXPLAIN_OPTIONS as readonly string[]).includes(value)
  );
}

export function isBlockedExplainReasonKey(
  value: unknown,
): value is BlockedExplainReasonKey {
  return (
    typeof value === "string" &&
    (BLOCKED_EXPLAIN_REASON_KEYS as readonly string[]).includes(value)
  );
}
