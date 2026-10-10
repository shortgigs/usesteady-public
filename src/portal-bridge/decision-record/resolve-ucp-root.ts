/**
 * Decision Record Bridge (DECISION_RECORD_BRIDGE_V1) - ucp_root_id resolver.
 *
 * The kernel's `GovernedDecisionRecord` carries no ucp_root_id: its identity is
 * the content-addressed `recordId` (sha256 over humanIntent + createdAt +
 * sections). But the Portal joins a decision record to a workflow page by
 * `ucp_root_id` (fallback `run_id`). Without a real root, an emitted record is
 * only visible on the org-wide proof surface, never on the workflow it belongs to.
 *
 * Resolution order:
 * 1. Portal-supplied root on the store envelope (`portalUcpRootId`) — set when
 *    the workflow handoff passes the workflow's ratified root from Understand.
 * 2. Derive from `humanIntent.goal` via `ensureUcpIntentRoot` — correct for CLI
 *    and single-intent paths where goal text matches the Understand bridge input.
 *
 * Portal handoff composes a richer goal (workPlan + step summaries), so (2)
 * alone produces a different root than the workflow's stored `ucp_root_id`.
 *
 * Side-channel safety: this runs inside the best-effort decision reporter, which
 * must NEVER affect the ratification path. It therefore returns `null` (omit the
 * link) rather than throwing on an empty goal or any persistence failure.
 */

import type { GovernedDecisionRecord } from "../../governed-decision/types.js";
import type { StoredRecord } from "../../governed-decision/store.js";
import { ensureUcpIntentRoot } from "../../ucp/ensure-intent-root.js";

/** Validate a portal-supplied 64-hex ucp_root_id. */
export function readPortalSuppliedUcpRootId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 64 && /^[a-f0-9]{64}$/.test(trimmed)) return trimmed;
  return null;
}

export type ResolveDecisionRecordUcpRootOptions = {
  /** Explicit portal root — preferred over goal derivation when valid. */
  readonly portalUcpRootId?: string | null;
};

/**
 * Resolve the ucp_root_id for a governed decision record, or `null` when it
 * cannot be derived (empty goal, or a persistence failure). Never throws.
 */
export function resolveDecisionRecordUcpRootId(
  record: GovernedDecisionRecord,
  storeDir: string,
  opts?: ResolveDecisionRecordUcpRootOptions,
): string | null {
  const explicit = readPortalSuppliedUcpRootId(opts?.portalUcpRootId);
  if (explicit !== null) return explicit;

  const goal =
    typeof record.humanIntent?.goal === "string" ? record.humanIntent.goal.trim() : "";
  if (goal.length === 0) return null;

  try {
    return ensureUcpIntentRoot(storeDir, goal).ucpRootId;
  } catch {
    // Side-channel: a failure to resolve/persist the root must never surface to
    // the ratification path. Omit the link; the record still emits with run_id.
    return null;
  }
}

/** Resolve ucp_root_id from a stored record (envelope link + goal fallback). */
export function resolveStoredRecordUcpRootId(
  stored: StoredRecord,
  storeDir: string,
): string | null {
  return resolveDecisionRecordUcpRootId(stored.record, storeDir, {
    ...(stored.envelope.portalUcpRootId !== undefined ? { portalUcpRootId: stored.envelope.portalUcpRootId } : {}),
  });
}
