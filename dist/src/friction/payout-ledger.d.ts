/**
 * src/friction/payout-ledger.ts
 *
 * Local SQLite ledger that records every admin decision (approved / rejected)
 * made against a friction GitHub Issue.
 *
 * Approved entries accumulate until a payout batch is triggered.
 * Rejected entries are kept for audit trail but excluded from payouts.
 *
 * LOCAL/UNSHIPPED (P4): this ledger can persist ReviewEvidenceBasis. The
 * callers that pass the reviewer's computed basis are gitignored admin
 * surfaces and are not part of the tracked P4 product closure claim.
 * The basis is stored as JSON in `evidence_basis` (NULL on pre-P4 rows).
 * Skip / API-access failures cannot enter `payout_ledger` (CHECK is
 * approved|rejected only); they are persisted in `friction_review_skips`
 * in the same database. Classification behavior is unchanged.
 *
 * DB path: ~/.usesteady/payout-ledger.sqlite
 * Override: USESTEADY_PAYOUT_LEDGER_PATH (tests).
 */
import type { ReviewEvidenceBasis } from "./reviewer.js";
export declare const PAYOUT_LEDGER_PATH_ENV = "USESTEADY_PAYOUT_LEDGER_PATH";
export type PayoutTier = "bronze" | "silver" | "gold" | "platinum";
export interface PayoutRecord {
    readonly id: string;
    readonly githubLogin: string;
    readonly issueNumber: number;
    readonly issueUrl: string;
    readonly verdict: "approved" | "rejected";
    readonly verdictReason: string;
    readonly confidence: number;
    readonly tier: PayoutTier | null;
    readonly decidedAt: string;
    readonly paidAt: string | null;
    /** P4: present only when a system-derived basis was stored. Absent = legacy. */
    readonly evidenceBasis?: ReviewEvidenceBasis;
}
export interface ReviewSkipRecord {
    readonly id: string;
    readonly githubLogin: string;
    readonly issueNumber: number;
    readonly issueUrl: string;
    readonly decision: "skip";
    readonly verdictReason: string;
    readonly confidence: number;
    readonly decidedAt: string;
    readonly evidenceBasis: ReviewEvidenceBasis;
}
/**
 * Whether a persisted decision carries a linked evidence-basis record.
 * Navigation is field-presence only: a missing/unreadable basis is
 * `legacy_unestablished`. Verdict, reason, and confidence are never consulted.
 */
export type LedgerEvidenceBasisLookup = {
    readonly status: "established";
    readonly basis: ReviewEvidenceBasis;
} | {
    readonly status: "legacy_unestablished";
};
/**
 * classifyLedgerEvidenceBasis — look up the persisted review-boundary record.
 *
 * Field-presence only. A missing, unreadable, or overclaiming stored blob is
 * `legacy_unestablished`. This function MUST NOT read verdict, reason, or
 * confidence — those cannot establish completeness or contradiction.
 */
export declare function classifyLedgerEvidenceBasis(record: {
    readonly evidenceBasis?: ReviewEvidenceBasis;
}): LedgerEvidenceBasisLookup;
/** Record an approved or rejected decision. Idempotent on issue_number. */
export declare function recordDecision(opts: {
    githubLogin: string;
    issueNumber: number;
    issueUrl: string;
    verdict: "approved" | "rejected";
    verdictReason: string;
    confidence: number;
    tier?: PayoutTier;
    evidenceBasis?: ReviewEvidenceBasis;
}): PayoutRecord;
/**
 * Persist a skip / access-failure review outcome with its evidence basis.
 * Skip cannot enter payout_ledger (CHECK + payout semantics). Same database,
 * separate table, so the review boundary is still reconstructable.
 */
export declare function recordReviewSkip(opts: {
    githubLogin: string;
    issueNumber: number;
    issueUrl: string;
    verdictReason: string;
    confidence: number;
    evidenceBasis: ReviewEvidenceBasis;
}): ReviewSkipRecord;
/** Latest skip record for an issue, or null if none. */
export declare function readReviewSkip(issueNumber: number): ReviewSkipRecord | null;
/** Return all approved, unpaid entries — the pending payout queue. */
export declare function pendingPayouts(): PayoutRecord[];
/** Return all entries (for display in `usesteady admin friction payouts`). */
export declare function allDecisions(limit?: number): PayoutRecord[];
/** Mark an approved entry as paid (after payment confirmation). */
export declare function markPaid(id: string): void;
/** Summary counts for display. */
export declare function ledgerStats(): {
    approved: number;
    rejected: number;
    paid: number;
    pendingPayout: number;
};
//# sourceMappingURL=payout-ledger.d.ts.map