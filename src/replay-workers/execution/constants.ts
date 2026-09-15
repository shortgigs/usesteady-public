/**
 * Replay worker execution defaults (pure — no side effects).
 * @see docs/product/replay-worker-execution-implementation-contract-v1.md
 */

export const REPLAY_WORKER_EXECUTION_VERSION = "v1";

/** Default execution eligibility TTL after dispatch — 5 minutes. */
export const REPLAY_WORKER_EXECUTION_ELIGIBILITY_TTL_MS = 300_000;
