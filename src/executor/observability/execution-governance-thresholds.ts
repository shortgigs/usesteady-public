/**
 * Deterministic execution governance rule thresholds (v1).
 * @see docs/product/executor-execution-governance-surface-contract-v1.md
 */

export const EXECUTION_GOVERNANCE_RULE_VERSION = "execution-governance-v1";

export const POLICY_REF_INV_WHO_11 = "INV-WHO-11";
export const POLICY_REF_INV_EDX_8 = "INV-EDX-8";
export const POLICY_REF_INV_COR_8 = "INV-COR-8";
export const POLICY_REF_INV_GOV_8 = "INV-GOV-8";

/** invariant_pressure_zones — diagnostic kinds that imply doctrine stress */
export const INVARIANT_PRESSURE_FINDING_KINDS = [
  "halt_cluster",
  "refusal_density",
  "mutation_instability",
] as const;
