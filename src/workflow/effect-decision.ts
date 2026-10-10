/**
 * Tool-agnostic effect-decision contract.
 *
 * This is the semantic boundary for deterministic effects. An adapter may
 * preserve provider/tool diagnostics separately, but it must not invent or
 * reinterpret the code that explains why the governed effect was refused.
 *
 * Keep this set intentionally narrower than the full CLI/kernel error universe:
 * it describes effect-policy / deterministic-execution refusals, not parser,
 * model-consensus, or transport failures.
 */
export const EFFECT_REFUSAL_CODES = [
  "target_exists",
  "effect_result_mismatch",
  "file_not_found",
  "merge_conflict",
  "old_value_not_found",
  "ambiguous_match",
  "scope_outside_allowed",
  "prohibited_pattern_match",
  "invalid_path",
  "outside_workspace",
  "effective_resource_unresolved",
  "effective_resource_changed",
  "invalid_filename_chars",
  "invalid_replacement_chars",
  "invalid_filename_reserved_name",
  "prohibited_path",
  "command_policy_violation",
] as const;

export type EffectRefusalCode = (typeof EFFECT_REFUSAL_CODES)[number];

export type EffectDecision =
  | {
      readonly kind: "accepted";
      readonly resultingContentSha256?: string;
    }
  | {
      readonly kind: "refused";
      readonly code: EffectRefusalCode;
      readonly detail?: string;
      /**
       * Optional raw diagnostic from a provider/tool/OS. Evidence only: it must
       * never determine or replace `code` after the semantic decision exists.
       */
      readonly rawDiagnostic?: string;
    };
