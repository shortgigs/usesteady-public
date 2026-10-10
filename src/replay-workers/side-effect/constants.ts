/**
 * Replay worker side-effect defaults (pure — no mutation).
 * @see docs/product/replay-worker-side-effect-runtime-contract-v1.md
 */

export const REPLAY_WORKER_SIDE_EFFECT_VERSION = "v1";

/** Default side-effect eligibility TTL after execution — 5 minutes. */
export const REPLAY_WORKER_SIDE_EFFECT_ELIGIBILITY_TTL_MS = 300_000;

export const REPLAY_WORKER_SIDE_EFFECT_SCOPES = [
  "descriptive_log",
  "descriptive_projection",
  "descriptive_trace",
] as const;

export type ReplayWorkerSideEffectScope =
  (typeof REPLAY_WORKER_SIDE_EFFECT_SCOPES)[number];

export function isReplayWorkerSideEffectScope(
  value: string,
): value is ReplayWorkerSideEffectScope {
  return (REPLAY_WORKER_SIDE_EFFECT_SCOPES as readonly string[]).includes(value);
}
