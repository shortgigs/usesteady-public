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
export {};
//# sourceMappingURL=types.js.map