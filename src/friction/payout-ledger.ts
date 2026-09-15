// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
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

import Database                from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname }               from "node:path";
import { homedir }               from "node:os";
import { join }                  from "node:path";
import { randomUUID }            from "node:crypto";
import type { ReviewEvidenceBasis } from "./reviewer.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const USESTEADY_DIR  = join(homedir(), ".usesteady");
export const PAYOUT_LEDGER_PATH_ENV = "USESTEADY_PAYOUT_LEDGER_PATH";

function resolveLedgerPath(): string {
  const override = process.env[PAYOUT_LEDGER_PATH_ENV];
  if (override !== undefined && override.length > 0) return override;
  return join(USESTEADY_DIR, "payout-ledger.sqlite");
}

function openLedger(): Database.Database {
  const ledgerPath = resolveLedgerPath();
  const dir = dirname(ledgerPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(ledgerPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS payout_ledger (
      id             TEXT    PRIMARY KEY,
      github_login   TEXT    NOT NULL,
      issue_number   INTEGER NOT NULL UNIQUE,
      issue_url      TEXT    NOT NULL,
      verdict        TEXT    NOT NULL CHECK(verdict IN ('approved','rejected')),
      verdict_reason TEXT    NOT NULL,
      confidence     INTEGER NOT NULL DEFAULT 0,
      tier           TEXT    NULL,
      decided_at     TEXT    NOT NULL,
      paid_at        TEXT    NULL,
      evidence_basis TEXT    NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_verdict ON payout_ledger(verdict);
    CREATE INDEX IF NOT EXISTS idx_ledger_paid    ON payout_ledger(paid_at);

    CREATE TABLE IF NOT EXISTS friction_review_skips (
      id             TEXT    PRIMARY KEY,
      github_login   TEXT    NOT NULL,
      issue_number   INTEGER NOT NULL,
      issue_url      TEXT    NOT NULL,
      verdict_reason TEXT    NOT NULL,
      confidence     INTEGER NOT NULL DEFAULT 0,
      evidence_basis TEXT    NOT NULL,
      decided_at     TEXT    NOT NULL
    );
  `);

  // Additive migrations: SQLite ignores duplicate columns via try/catch.
  try { db.exec("ALTER TABLE payout_ledger ADD COLUMN tier TEXT NULL"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE payout_ledger ADD COLUMN evidence_basis TEXT NULL"); } catch { /* column already exists */ }

  return db;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PayoutTier = "bronze" | "silver" | "gold" | "platinum";

export interface PayoutRecord {
  readonly id:            string;
  readonly githubLogin:   string;
  readonly issueNumber:   number;
  readonly issueUrl:      string;
  readonly verdict:       "approved" | "rejected";
  readonly verdictReason: string;
  readonly confidence:    number;
  readonly tier:          PayoutTier | null;
  readonly decidedAt:     string;
  readonly paidAt:        string | null;
  /** P4: present only when a system-derived basis was stored. Absent = legacy. */
  readonly evidenceBasis?: ReviewEvidenceBasis;
}

export interface ReviewSkipRecord {
  readonly id:            string;
  readonly githubLogin:   string;
  readonly issueNumber:   number;
  readonly issueUrl:      string;
  readonly decision:      "skip";
  readonly verdictReason: string;
  readonly confidence:    number;
  readonly decidedAt:     string;
  readonly evidenceBasis: ReviewEvidenceBasis;
}

/**
 * Whether a persisted decision carries a linked evidence-basis record.
 * Navigation is field-presence only: a missing/unreadable basis is
 * `legacy_unestablished`. Verdict, reason, and confidence are never consulted.
 */
export type LedgerEvidenceBasisLookup =
  | { readonly status: "established";          readonly basis: ReviewEvidenceBasis }
  | { readonly status: "legacy_unestablished" };

interface LedgerRow {
  id:             string;
  github_login:   string;
  issue_number:   number;
  issue_url:      string;
  verdict:        "approved" | "rejected";
  verdict_reason: string;
  confidence:     number;
  tier:           string | null;
  decided_at:     string;
  paid_at:        string | null;
  evidence_basis: string | null;
}

interface SkipRow {
  id:             string;
  github_login:   string;
  issue_number:   number;
  issue_url:      string;
  verdict_reason: string;
  confidence:     number;
  evidence_basis: string;
  decided_at:     string;
}

const VALID_TIERS = new Set(["bronze", "silver", "gold", "platinum"]);

function isStoredBasis(value: unknown): value is ReviewEvidenceBasis {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (o["comprehension"] !== "not_established") return false;
  if (o["evidenceBackedContradiction"] !== "not_established") return false;
  if (o["completeness"] !== "partial_bounded_extract") return false;
  if (o["derivation"] !== "system_structural_v1") return false;
  if (o["mode"] !== "ai" && o["mode"] !== "rule_based") return false;
  if (o["accessStatus"] !== "ok" && o["accessStatus"] !== "api_error" && o["accessStatus"] !== "no_api_key") {
    return false;
  }
  if (typeof o["extractHash"] !== "string" || !/^[0-9a-f]{64}$/.test(o["extractHash"])) return false;
  if (!Array.isArray(o["truncatedFields"])) return false;
  if (!Array.isArray(o["sources"])) return false;
  return true;
}

function parseStoredBasis(raw: string | null | undefined): ReviewEvidenceBasis | undefined {
  if (raw === null || raw === undefined || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredBasis(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function serializeBasis(basis: ReviewEvidenceBasis): string {
  if (!isStoredBasis(basis)) {
    throw new Error("evidenceBasis failed closed: locked literals or required fields are invalid");
  }
  return JSON.stringify(basis);
}

function rowToRecord(row: LedgerRow): PayoutRecord {
  const tier = row.tier && VALID_TIERS.has(row.tier) ? (row.tier as PayoutTier) : null;
  const evidenceBasis = parseStoredBasis(row.evidence_basis);
  return {
    id:            row.id,
    githubLogin:   row.github_login,
    issueNumber:   row.issue_number,
    issueUrl:      row.issue_url,
    verdict:       row.verdict,
    verdictReason: row.verdict_reason,
    confidence:    row.confidence,
    tier,
    decidedAt:     row.decided_at,
    paidAt:        row.paid_at ?? null,
    ...(evidenceBasis !== undefined ? { evidenceBasis } : {}),
  };
}

/**
 * classifyLedgerEvidenceBasis — look up the persisted review-boundary record.
 *
 * Field-presence only. A missing, unreadable, or overclaiming stored blob is
 * `legacy_unestablished`. This function MUST NOT read verdict, reason, or
 * confidence — those cannot establish completeness or contradiction.
 */
export function classifyLedgerEvidenceBasis(
  record: { readonly evidenceBasis?: ReviewEvidenceBasis },
): LedgerEvidenceBasisLookup {
  if (record.evidenceBasis === undefined) return { status: "legacy_unestablished" };
  if (!isStoredBasis(record.evidenceBasis)) return { status: "legacy_unestablished" };
  return { status: "established", basis: record.evidenceBasis };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Record an approved or rejected decision. Idempotent on issue_number. */
export function recordDecision(opts: {
  githubLogin:   string;
  issueNumber:   number;
  issueUrl:      string;
  verdict:       "approved" | "rejected";
  verdictReason: string;
  confidence:    number;
  tier?:         PayoutTier;
  evidenceBasis?: ReviewEvidenceBasis;
}): PayoutRecord {
  const db  = openLedger();
  const id  = randomUUID();
  const now = new Date().toISOString();
  const tier = opts.tier ?? null;
  const basisJson = opts.evidenceBasis !== undefined ? serializeBasis(opts.evidenceBasis) : null;

  // INSERT OR IGNORE ensures the UNIQUE(issue_number) constraint is the single
  // guard against double-payouts, even under concurrent admin runs.
  db.prepare(`
    INSERT OR IGNORE INTO payout_ledger
      (id, github_login, issue_number, issue_url, verdict, verdict_reason, confidence, tier, decided_at, evidence_basis)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.githubLogin, opts.issueNumber, opts.issueUrl, opts.verdict,
    opts.verdictReason, opts.confidence, tier, now, basisJson,
  );

  const row = db
    .prepare("SELECT * FROM payout_ledger WHERE issue_number = ?")
    .get(opts.issueNumber) as LedgerRow;
  db.close();
  return rowToRecord(row);
}

/**
 * Persist a skip / access-failure review outcome with its evidence basis.
 * Skip cannot enter payout_ledger (CHECK + payout semantics). Same database,
 * separate table, so the review boundary is still reconstructable.
 */
export function recordReviewSkip(opts: {
  githubLogin:    string;
  issueNumber:    number;
  issueUrl:       string;
  verdictReason:  string;
  confidence:     number;
  evidenceBasis:  ReviewEvidenceBasis;
}): ReviewSkipRecord {
  const db  = openLedger();
  const id  = randomUUID();
  const now = new Date().toISOString();
  const basisJson = serializeBasis(opts.evidenceBasis);

  db.prepare(`
    INSERT INTO friction_review_skips
      (id, github_login, issue_number, issue_url, verdict_reason, confidence, evidence_basis, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.githubLogin, opts.issueNumber, opts.issueUrl,
    opts.verdictReason, opts.confidence, basisJson, now,
  );

  const row = db
    .prepare("SELECT * FROM friction_review_skips WHERE id = ?")
    .get(id) as SkipRow;
  db.close();
  return skipRowToRecord(row);
}

/** Latest skip record for an issue, or null if none. */
export function readReviewSkip(issueNumber: number): ReviewSkipRecord | null {
  const db  = openLedger();
  const row = db
    .prepare("SELECT * FROM friction_review_skips WHERE issue_number = ? ORDER BY decided_at DESC LIMIT 1")
    .get(issueNumber) as SkipRow | undefined;
  db.close();
  return row === undefined ? null : skipRowToRecord(row);
}

function skipRowToRecord(row: SkipRow): ReviewSkipRecord {
  const evidenceBasis = parseStoredBasis(row.evidence_basis);
  if (evidenceBasis === undefined) {
    throw new Error("friction_review_skips row failed closed: evidence_basis is unreadable");
  }
  return {
    id:            row.id,
    githubLogin:   row.github_login,
    issueNumber:   row.issue_number,
    issueUrl:      row.issue_url,
    decision:      "skip",
    verdictReason: row.verdict_reason,
    confidence:    row.confidence,
    decidedAt:     row.decided_at,
    evidenceBasis,
  };
}

/** Return all approved, unpaid entries — the pending payout queue. */
export function pendingPayouts(): PayoutRecord[] {
  const db   = openLedger();
  const rows = db
    .prepare("SELECT * FROM payout_ledger WHERE verdict = 'approved' AND paid_at IS NULL ORDER BY decided_at ASC")
    .all() as LedgerRow[];
  db.close();
  return rows.map(rowToRecord);
}

/** Return all entries (for display in `usesteady admin friction payouts`). */
export function allDecisions(limit = 100): PayoutRecord[] {
  const db   = openLedger();
  const rows = db
    .prepare("SELECT * FROM payout_ledger ORDER BY decided_at DESC LIMIT ?")
    .all(limit) as LedgerRow[];
  db.close();
  return rows.map(rowToRecord);
}

/** Mark an approved entry as paid (after payment confirmation). */
export function markPaid(id: string): void {
  const db  = openLedger();
  const now = new Date().toISOString();
  db.prepare("UPDATE payout_ledger SET paid_at = ? WHERE id = ? AND verdict = 'approved'").run(now, id);
  db.close();
}

/** Summary counts for display. */
export function ledgerStats(): { approved: number; rejected: number; paid: number; pendingPayout: number } {
  const db    = openLedger();
  const total = db.prepare("SELECT verdict, COUNT(*) as n FROM payout_ledger GROUP BY verdict").all() as Array<{ verdict: string; n: number }>;
  const paid  = (db.prepare("SELECT COUNT(*) as n FROM payout_ledger WHERE paid_at IS NOT NULL").get() as { n: number }).n;
  db.close();

  const approved = total.find(r => r.verdict === "approved")?.n ?? 0;
  const rejected = total.find(r => r.verdict === "rejected")?.n ?? 0;
  return { approved, rejected, paid, pendingPayout: approved - paid };
}
