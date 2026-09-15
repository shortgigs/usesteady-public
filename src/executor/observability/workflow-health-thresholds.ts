/**
 * Deterministic workflow health rule thresholds (v1).
 * @see docs/product/executor-workflow-health-surface-contract-v1.md
 */

export const WORKFLOW_HEALTH_RULE_VERSION = "v1";

export const DEFAULT_WINDOW_HOURS = 24;
export const MAX_WINDOW_HOURS = 168;

/** stalled_chain_detected — chain incomplete or halted beyond age */
export const STALLED_CHAIN_AGE_MS = 300_000;

/** retry_spike_detected — idempotent / transport retries in window */
export const RETRY_SPIKE_MIN_COUNT = 3;

/** pending_duration_exceeded — awaiting authority */
export const PENDING_DURATION_MS = 120_000;

/** failure_rate_elevated */
export const FAILURE_RATE_MIN_SAMPLES = 3;
export const FAILURE_RATE_THRESHOLD = 0.4;

/** queue_pressure_detected — evidence backlog in store */
export const QUEUE_PRESSURE_MIN_BUNDLES = 10;
