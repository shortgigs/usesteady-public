/**
 * Replay worker mutation defaults (pure — no unrestricted mutation).
 * @see docs/product/replay-worker-bounded-mutation-runtime-contract-v1.md
 */

export const REPLAY_WORKER_MUTATION_VERSION = "v1";

/** Default mutation eligibility TTL after side effect — 5 minutes. */
export const REPLAY_WORKER_MUTATION_ELIGIBILITY_TTL_MS = 300_000;

export const REPLAY_WORKER_MUTATION_SCOPES = [
  "replay_namespace_audit_append_only",
  "replay_namespace_single_path_metadata",
  "replay_namespace_trace_line_append",
] as const;

export type ReplayWorkerMutationScope =
  (typeof REPLAY_WORKER_MUTATION_SCOPES)[number];

export function isReplayWorkerMutationScope(
  value: string,
): value is ReplayWorkerMutationScope {
  return (REPLAY_WORKER_MUTATION_SCOPES as readonly string[]).includes(value);
}
