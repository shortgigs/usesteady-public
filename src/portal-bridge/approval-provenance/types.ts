/**
 * Phase 3 Lane A (A2) — bridge approval provenance accumulator state.
 *
 * Collects `decided_by` / `decided_at` from Portal pending-approval bridge
 * outcomes during a workflow run. Pure transport-sidecar only — no authority.
 *
 * P1 authority carry: every collected approval is labeled with its evidence
 * status. `portal_signed_verified` means Core verified the signed assertion
 * against a pinned Portal authority key and the exact live gate; anything else
 * is `self_asserted` transport metadata. The signed assertion is preserved
 * verbatim when present — verified values are never collapsed back into a bare
 * approver string with the proof discarded.
 */

import type { AuthorityAssertion } from "../authority-assertion/types.js";

export type BridgeApprovalAuthority = {
  readonly status: "portal_signed_verified" | "self_asserted";
  readonly key_id?: string | null;
  readonly assertion?: AuthorityAssertion;
};

/** Last bridge approval with non-empty identity, or null when none collected. */
export type BridgeApprovalProvenanceState = {
  readonly lastBridgeApproval: {
    readonly decided_by: string;
    readonly decided_at: string | null;
    readonly authority: BridgeApprovalAuthority;
  } | null;
};

export type ExecutionReturnApprovalProvenance = {
  readonly approver: string | null;
  readonly approved_at: string | null;
  /** P1: hard evidence-status label. Never claims verified human identity. */
  readonly authority_status: "portal_signed_verified" | "self_asserted";
  /** P1: the verified signed assertion, preserved when present. */
  readonly authority_assertion?: AuthorityAssertion | null;
};
