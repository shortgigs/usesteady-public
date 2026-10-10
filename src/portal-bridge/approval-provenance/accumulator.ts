/**
 * Phase 3 Lane A (A2) — accumulate bridge decisions and resolve execution-return
 * approval_record fields per frozen mapping (PHASE3_APPROVAL_PROVENANCE_SOURCE_AUDIT_V1).
 */

import type { ApprovalDecisionEntry } from "../pending-approval/decision.js";
import type { RemoteAuthorityEvidence } from "../pending-approval/resolve-remote.js";
import type {
  BridgeApprovalAuthority,
  BridgeApprovalProvenanceState,
  ExecutionReturnApprovalProvenance,
} from "./types.js";
import { maxHandoffConfirmedAtIso } from "./handoff-timestamp.js";

export function createBridgeApprovalProvenanceState(): BridgeApprovalProvenanceState {
  return { lastBridgeApproval: null };
}

function toBridgeApprovalAuthority(
  authority: RemoteAuthorityEvidence | undefined,
): BridgeApprovalAuthority {
  if (authority?.status === "portal_signed_verified") {
    return {
      status: "portal_signed_verified",
      key_id: authority.assertion.payload.key_id,
      assertion: authority.assertion,
    };
  }
  return { status: "self_asserted" };
}

/**
 * Record an approved bridge decision. Only `approved` entries with non-empty
 * `decided_by` are stored; later approvals overwrite (last wins for multi-step).
 * The P1 authority evidence rides alongside; absence of evidence is recorded as
 * `self_asserted`, never silently upgraded.
 */
export function recordBridgeApprovalDecision(
  state: BridgeApprovalProvenanceState,
  entry: ApprovalDecisionEntry,
  authority?: RemoteAuthorityEvidence,
): BridgeApprovalProvenanceState {
  if (entry.status !== "approved") return state;

  const decidedBy = entry.decided_by?.trim();
  if (!decidedBy) return state;

  const decidedAtRaw = entry.decided_at?.trim();
  return {
    lastBridgeApproval: {
      decided_by: decidedBy,
      decided_at: decidedAtRaw && decidedAtRaw.length > 0 ? decidedAtRaw : null,
      authority: toBridgeApprovalAuthority(authority),
    },
  };
}

/**
 * Web POST /confirm (S2): fold a remote Portal decision into per-run provenance.
 *
 * Only a remote `yes` with an approved entry updates state (same rule as CLI).
 * Reject / null / missing prior state leave provenance unchanged (or empty).
 * Pure transport-sidecar — no authority.
 */
export function accumulateBridgeApprovalFromRemote(
  state: BridgeApprovalProvenanceState | undefined,
  remote: {
    readonly decision: "yes" | "no";
    readonly entry: ApprovalDecisionEntry;
    readonly authority?: RemoteAuthorityEvidence;
  } | null,
): BridgeApprovalProvenanceState {
  const base = state ?? createBridgeApprovalProvenanceState();
  if (remote === null || remote.decision !== "yes") return base;
  return recordBridgeApprovalDecision(base, remote.entry, remote.authority);
}

/**
 * Apply Mode A / Mode B precedence for execution-return `approval_record`:
 *   Mode A — any bridge `decided_by` collected → approver + decided_at from bridge
 *   Mode B — else → approver null, approved_at from max UCP handoff confirmedAt
 * Mode B is always `self_asserted` (UCP handoff timestamps are transport
 * metadata, not authenticated human provenance).
 */
export function resolveExecutionReturnApprovalProvenance(
  bridgeState: BridgeApprovalProvenanceState,
  storeDir: string,
  workflowRunId: string,
): ExecutionReturnApprovalProvenance {
  if (bridgeState.lastBridgeApproval) {
    const last = bridgeState.lastBridgeApproval;
    return {
      approver: last.decided_by,
      approved_at: last.decided_at,
      authority_status: last.authority.status,
      authority_assertion: last.authority.assertion ?? null,
    };
  }

  return {
    approver: null,
    approved_at: maxHandoffConfirmedAtIso(storeDir, workflowRunId),
    authority_status: "self_asserted",
    authority_assertion: null,
  };
}
