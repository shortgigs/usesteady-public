/**
 * Governed Decision Store — append-only JSONL persistence for kernel records.
 *
 * Canonical design: docs/architecture/USESTEADY_GOVERNED_DECISION_SURFACE_V1.md
 *
 * ── What it stores ────────────────────────────────────────────────────────────
 *
 *   One JSON line per StoredRecord: a store-level envelope wrapping an UNTOUCHED
 *   `GovernedDecisionRecord`. The envelope carries draft/final linkage
 *   (`threadId`, `supersedes`) so the frozen kernel type is never modified.
 *
 * ── Invariants ────────────────────────────────────────────────────────────────
 *
 *   - Append-only: records are never mutated or deleted in place. A decision's
 *     evolution is draft -> final: two lines, never an edit.
 *   - Idempotent: re-appending a record with an existing `recordId` is a no-op
 *     (the kernel recordId is a content hash).
 *   - Never throws on read: a malformed/partial line is skipped, mirroring the
 *     projection's never-throws contract, so a corrupt append cannot crash a
 *     read surface.
 *   - Zero authority: the store only persists and returns records. It never sets
 *     a section status, decides anything, or invents a value.
 */

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { GovernedDecisionRecord, RatificationDecision } from "./types.js";

// ─── Stored shapes ──────────────────────────────────────────────────────────

export type StoredKind = "draft" | "final";

export type StoredEnvelope = {
  /** Groups a draft with its final. */
  readonly threadId: string;
  readonly kind: StoredKind;
  /** Store-level ISO timestamp (distinct from the record's own createdAt). */
  readonly storedAt: string;
  /** For a final: the draft recordId it supersedes. Null for a draft. */
  readonly supersedes: string | null;
  /**
   * Portal-supplied ucp_root_id (store envelope only — not part of the content
   * hash). Set when a workflow handoff passes the workflow's ratified root so
   * bridge emissions join the workflow page instead of re-deriving from the
   * composed handoff goal (which includes step summaries).
   */
  readonly portalUcpRootId?: string;
};

export type AppendDraftOptions = {
  readonly portalUcpRootId?: string;
};

function normalizePortalUcpRootId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 64 && /^[a-f0-9]{64}$/.test(trimmed)) return trimmed;
  return undefined;
}

export type StoredRecord = {
  readonly envelope: StoredEnvelope;
  /** The untouched kernel artifact. */
  readonly record: GovernedDecisionRecord;
};

/** A read-model summary of one decision thread (draft + optional final). */
export type ThreadSummary = {
  readonly threadId: string;
  readonly goal: string;
  readonly draftRecordId: string | null;
  readonly finalRecordId: string | null;
  /** The ratified decision when a final exists and its ratification is connected. */
  readonly ratifiedDecision: RatificationDecision | null;
  /** Earliest record createdAt in the thread (for stable ordering). */
  readonly createdAt: string;
};

export type GovernedDecisionStore = {
  /**
   * Low-level idempotent append. Returns the AUTHORITATIVE persisted record: if
   * a record with this recordId is already on disk, the existing StoredRecord
   * (with its original envelope/threadId) is returned and nothing is written.
   */
  appendRecord(stored: StoredRecord): StoredRecord;
  /** Append a draft; returns the StoredRecord (so the caller learns the threadId). */
  appendDraft(record: GovernedDecisionRecord, opts?: AppendDraftOptions): StoredRecord;
  /** Append a final linked to a draft (same threadId, supersedes the draft). */
  appendFinal(
    record: GovernedDecisionRecord,
    threadId: string,
    draftRecordId: string,
  ): StoredRecord;
  readAll(): readonly StoredRecord[];
  getRecord(recordId: string): StoredRecord | null;
  listThreads(): readonly ThreadSummary[];
  /**
   * Atomically claim the TRANSIENT in-flight ratification slot for a thread.
   * Returns true if the caller won the claim, false if it is already held. Backed
   * by an exclusive file create (`openSync(..,"wx")`) — an atomic test-and-set on
   * POSIX and Windows — so two concurrent ratify attempts (across processes / CLI
   * + HTTP on the same store) cannot both produce a final and flip the decision
   * during the produce+append window.
   *
   * This is NOT the durable record of ratification — the stored FINAL is. Callers
   * release the claim in a `finally` (every outcome), and rely on the presence of
   * a stored final as the self-healing single-ratification source of truth. A hard
   * process crash between claim and append can orphan the marker; that edge is the
   * province of the E4 persistent DB backend (real transactions), not this file.
   */
  tryClaimRatification(threadId: string): boolean;
  /** Release a previously-won ratification claim (called in `finally`). */
  releaseRatificationClaim(threadId: string): void;
};

// ─── Validation (never-throws reads) ──────────────────────────────────────────

/**
 * Minimal structural validation of a parsed line. We do NOT deeply validate the
 * record (the projection layer is already defensive about any record shape); we
 * only confirm the envelope + a recordId are present so grouping/idempotency
 * work. Anything that fails is skipped, never thrown.
 */
function isStoredRecordShape(value: unknown): value is StoredRecord {
  if (value === null || typeof value !== "object") return false;
  const v = value as { envelope?: unknown; record?: unknown };
  if (v.envelope === null || typeof v.envelope !== "object") return false;
  if (v.record === null || typeof v.record !== "object") return false;
  const env = v.envelope as { threadId?: unknown; kind?: unknown };
  const rec = v.record as { recordId?: unknown };
  if (typeof env.threadId !== "string") return false;
  if (env.kind !== "draft" && env.kind !== "final") return false;
  if (typeof rec.recordId !== "string") return false;
  return true;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a store bound to a directory. Defaults to
 * `~/.usesteady/governed-decisions`. Tests always pass a temp dir.
 */
export function createGovernedDecisionStore(dir?: string): GovernedDecisionStore {
  const baseDir = dir ?? join(homedir(), ".usesteady", "governed-decisions");
  const filePath = join(baseDir, "records.jsonl");

  function ensureDir(): void {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  }

  function readAll(): readonly StoredRecord[] {
    if (!existsSync(filePath)) return [];
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      return [];
    }
    const out: StoredRecord[] = [];
    // Logical idempotency enforced on READ: collapse any duplicate recordId
    // (possible if two processes ever race the non-atomic append) keeping the
    // FIRST occurrence — the authoritative envelope. recordId is a content hash,
    // so duplicate lines carry identical record content; first-append-wins
    // matches appendRecord's "existing wins" semantics and guarantees the
    // idempotent-on-recordId contract at the API level WITHOUT write-time
    // locking. A racing duplicate can never produce a phantom second thread.
    const seenRecordIds = new Set<string>();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Malformed/partial line — skip honestly, never throw.
        continue;
      }
      if (isStoredRecordShape(parsed)) {
        if (seenRecordIds.has(parsed.record.recordId)) continue;
        seenRecordIds.add(parsed.record.recordId);
        out.push(parsed);
      }
    }
    return out;
  }

  function appendRecord(stored: StoredRecord): StoredRecord {
    // Idempotency: a content-addressed recordId already on disk is authoritative.
    // Returning the EXISTING StoredRecord (not the caller's freshly-built one)
    // means a retry/no-op never hands back a phantom envelope/threadId that was
    // never persisted — which would otherwise let a later appendFinal link to a
    // thread that has no stored draft.
    const existing = readAll().find((s) => s.record.recordId === stored.record.recordId);
    if (existing) return existing;
    ensureDir();
    appendFileSync(filePath, `${JSON.stringify(stored)}\n`, "utf8");
    // Re-read and return the AUTHORITATIVE record (first occurrence after dedup),
    // not the caller's `stored`. If a concurrent writer won the race, its line is
    // first and we return ITS envelope/threadId — so a caller never walks away
    // with a loser threadId that a later appendFinal would orphan. readAll dedups
    // keeping the first occurrence, so this is the same record listThreads reports.
    const authoritative = readAll().find((s) => s.record.recordId === stored.record.recordId);
    return authoritative ?? stored;
  }

  function appendDraft(record: GovernedDecisionRecord, opts?: AppendDraftOptions): StoredRecord {
    const portalUcpRootId = normalizePortalUcpRootId(opts?.portalUcpRootId);
    // appendRecord returns the authoritative stored record: if this draft already
    // exists, its ORIGINAL threadId is returned and the freshly-minted one here is
    // discarded. The caller always learns the real, persisted threadId.
    return appendRecord({
      envelope: {
        threadId: randomUUID(),
        kind: "draft",
        storedAt: new Date().toISOString(),
        supersedes: null,
        ...(portalUcpRootId !== undefined ? { portalUcpRootId } : {}),
      },
      record,
    });
  }

  function appendFinal(
    record: GovernedDecisionRecord,
    threadId: string,
    draftRecordId: string,
  ): StoredRecord {
    const draft = readAll().find((s) => s.record.recordId === draftRecordId);
    const portalUcpRootId = normalizePortalUcpRootId(draft?.envelope.portalUcpRootId);
    return appendRecord({
      envelope: {
        threadId,
        kind: "final",
        storedAt: new Date().toISOString(),
        supersedes: draftRecordId,
        ...(portalUcpRootId !== undefined ? { portalUcpRootId } : {}),
      },
      record,
    });
  }

  function getRecord(recordId: string): StoredRecord | null {
    return readAll().find((s) => s.record.recordId === recordId) ?? null;
  }

  function listThreads(): readonly ThreadSummary[] {
    const all = readAll();
    const byThread = new Map<string, StoredRecord[]>();
    for (const s of all) {
      const list = byThread.get(s.envelope.threadId) ?? [];
      list.push(s);
      byThread.set(s.envelope.threadId, list);
    }

    const summaries: ThreadSummary[] = [];
    for (const [threadId, records] of byThread) {
      // `records` preserves append (file) order. The model is one draft + one
      // final per thread, but the log is append-only and could contain more than
      // one final (e.g. a retry that produced a distinct recordId). The summary
      // must reflect the MOST RECENT final, never a stale one — so pick the LAST
      // final in append order (deterministic; no timestamp-tie ambiguity).
      const drafts = records.filter((r) => r.envelope.kind === "draft");
      const finals = records.filter((r) => r.envelope.kind === "final");
      const draft = drafts[0] ?? null;
      const final = finals.length > 0 ? finals[finals.length - 1]! : null;

      // Goal: prefer the draft, else any record in the thread. Read-only.
      const goalSource = draft ?? final ?? records[0];
      const goal =
        goalSource && typeof goalSource.record.humanIntent?.goal === "string"
          ? goalSource.record.humanIntent.goal
          : "";

      // Ratified decision: only when a final exists with a connected ratification.
      // Defensive: a line can pass minimal shape validation without a well-formed
      // ratification section (tampered/partial record). Honor the never-throws
      // read contract — guard every dereference, never assume the section shape.
      let ratifiedDecision: RatificationDecision | null = null;
      const finalRatification = final?.record?.ratification as
        | { status?: unknown; value?: { decision?: unknown } }
        | undefined;
      if (
        finalRatification !== undefined &&
        finalRatification !== null &&
        finalRatification.status === "connected" &&
        finalRatification.value !== null &&
        typeof finalRatification.value === "object" &&
        typeof finalRatification.value.decision === "string"
      ) {
        ratifiedDecision = finalRatification.value.decision as RatificationDecision;
      }

      const createdAt = records
        .map((r) => r.record.createdAt)
        .filter((c): c is string => typeof c === "string")
        .sort()[0] ?? "";

      summaries.push({
        threadId,
        goal,
        draftRecordId: draft ? draft.record.recordId : null,
        finalRecordId: final ? final.record.recordId : null,
        ratifiedDecision,
        createdAt,
      });
    }

    // Stable, newest-first ordering by earliest record time.
    summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return summaries;
  }

  // ─── Atomic single-ratification claim ──────────────────────────────────────

  const RATIFIED_DIR = ".ratified";

  function ratificationMarkerPath(threadId: string): string | null {
    // threadId reaches here from a URL/path; only allow a safe charset so the
    // marker filename can never traverse outside the store directory.
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(threadId)) return null;
    return join(baseDir, RATIFIED_DIR, `${threadId}.lock`);
  }

  function tryClaimRatification(threadId: string): boolean {
    const markerPath = ratificationMarkerPath(threadId);
    if (markerPath === null) {
      // Misuse, not contention — a malformed threadId must never masquerade as
      // "being ratified". Throw so the caller's error path surfaces the real fault.
      throw new Error(`invalid threadId for ratification claim: ${threadId}`);
    }
    const markerDir = join(baseDir, RATIFIED_DIR);
    if (!existsSync(markerDir)) mkdirSync(markerDir, { recursive: true });
    try {
      // "wx" fails atomically if the file already exists — the test-and-set.
      closeSync(openSync(markerPath, "wx"));
      return true;
    } catch (err) {
      // EEXIST is the ONLY "false" — a genuine concurrent claim. Any other error
      // (disk full, permission denied, unreadable store) is a real storage fault
      // that must propagate, not be hidden behind a transient-concurrency message.
      if ((err as NodeJS.ErrnoException | null)?.code === "EEXIST") return false;
      throw err;
    }
  }

  function releaseRatificationClaim(threadId: string): void {
    const markerPath = ratificationMarkerPath(threadId);
    if (markerPath === null) return;
    try {
      unlinkSync(markerPath);
    } catch {
      // Already gone / never created — nothing to release.
    }
  }

  return {
    appendRecord,
    appendDraft,
    appendFinal,
    readAll,
    getRecord,
    listThreads,
    tryClaimRatification,
    releaseRatificationClaim,
  };
}
