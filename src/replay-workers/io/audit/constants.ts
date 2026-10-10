/**
 * Replay namespace audit append-only I/O defaults.
 * @see docs/product/replay-namespace-audit-append-only-implementation-contract-v1.md
 */

export const REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE =
  "replay_namespace_audit_append_only" as const;

export type ReplayNamespaceAuditAppendOnlyScope =
  typeof REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE;

export const REPLAY_WORKER_PER_SCOPE_IO_VERSION = "v1";

/** Default I/O eligibility TTL after mutation record — 5 minutes. */
export const REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS = 300_000;

/** Max audit line message length (bounded payload). */
export const REPLAY_NAMESPACE_AUDIT_LINE_MESSAGE_MAX = 4_096;

export function isReplayNamespaceAuditAppendOnlyScope(
  value: string,
): value is ReplayNamespaceAuditAppendOnlyScope {
  return value === REPLAY_NAMESPACE_AUDIT_APPEND_ONLY_SCOPE;
}
