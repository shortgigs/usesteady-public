/**
 * Deterministic execution diagnostics rule thresholds (v1).
 * @see docs/product/executor-execution-diagnostics-surface-contract-v1.md
 */

export const EXECUTION_DIAGNOSTICS_RULE_VERSION = "execution-diagnostics-v1";

/** repeated_halt_clustering — halted outcomes in evidence window */
export const HALT_CLUSTER_MIN_COUNT = 1;

/** mutation_instability_zones — jobs with halt-after-mutation pattern */
export const MUTATION_INSTABILITY_MIN_JOBS = 1;

/** decision_refusal_density — refusal/denial decision entries in window */
export const REFUSAL_DENSITY_MIN_COUNT = 1;
