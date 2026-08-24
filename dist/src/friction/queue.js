// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/queue.ts
 *
 * SQLite-backed local queue for friction events.
 *
 * Events are written here first (synchronously, fire-and-forget),
 * then flushed to the collection backend asynchronously with retries.
 * This ensures the core workflow path is never blocked or slowed.
 *
 * Storage: ~/.usesteady/friction-queue.db
 * Schema:  one table — friction_queue
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// ─── Paths ────────────────────────────────────────────────────────────────────
const USESTEADY_DIR = join(homedir(), ".usesteady");
const DB_PATH = join(USESTEADY_DIR, "friction-queue.db");
// ─── Lazy singleton DB ────────────────────────────────────────────────────────
let _db = null;
function db() {
    if (_db)
        return _db;
    if (!existsSync(USESTEADY_DIR))
        mkdirSync(USESTEADY_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.exec(`
    CREATE TABLE IF NOT EXISTS friction_queue (
      id           TEXT PRIMARY KEY,
      event_json   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      attempts     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      submitted_at TEXT,
      last_error   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_status ON friction_queue (status);
  `);
    return _db;
}
// ─── Serialisation helpers ────────────────────────────────────────────────────
function rowToEntry(row) {
    const base = {
        id: row["id"],
        event: JSON.parse(row["event_json"]),
        status: row["status"],
        attempts: row["attempts"],
        createdAt: row["created_at"],
    };
    return {
        ...base,
        ...(row["submitted_at"] ? { submittedAt: row["submitted_at"] } : {}),
        ...(row["last_error"] ? { lastError: row["last_error"] } : {}),
    };
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Add a new friction event to the queue.
 * Called synchronously (no await) from auto-capture hooks so the
 * core workflow path is never delayed.
 */
export function enqueue(event) {
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
        db().prepare(`
      INSERT INTO friction_queue (id, event_json, status, attempts, created_at)
      VALUES (?, ?, 'pending', 0, ?)
    `).run(id, JSON.stringify(event), now);
    }
    catch (err) {
        // Queue write failure must never propagate to the caller — this is a
        // best-effort side-channel.
        process.stderr.write(`[friction-queue] enqueue failed: ${String(err)}\n`);
    }
    return id;
}
/**
 * Return all entries with the given status.
 */
export function listByStatus(status) {
    try {
        const rows = db().prepare("SELECT * FROM friction_queue WHERE status = ? ORDER BY created_at ASC").all(status);
        return rows.map(rowToEntry);
    }
    catch {
        return [];
    }
}
/**
 * Return pending entries older than `olderThanMs` milliseconds,
 * up to `limit`. Used by the flush loop to pick retry candidates.
 */
export function pendingEntries(limit = 20) {
    try {
        const rows = db().prepare(`
      SELECT * FROM friction_queue
      WHERE  status = 'pending'
      ORDER  BY created_at ASC
      LIMIT  ?
    `).all(limit);
        return rows.map(rowToEntry);
    }
    catch {
        return [];
    }
}
/**
 * Mark an entry as successfully submitted.
 */
export function markSubmitted(id) {
    try {
        db().prepare(`
      UPDATE friction_queue
      SET    status = 'submitted', submitted_at = ?, attempts = attempts + 1
      WHERE  id = ?
    `).run(new Date().toISOString(), id);
    }
    catch (err) {
        process.stderr.write(`[friction-queue] markSubmitted failed: ${String(err)}\n`);
    }
}
/**
 * Record a submission attempt failure. After MAX_ATTEMPTS the entry
 * is moved to 'failed' so it doesn't clog the retry loop forever.
 */
const MAX_ATTEMPTS = 5;
export function markFailed(id, error) {
    try {
        const row = db().prepare("SELECT attempts FROM friction_queue WHERE id = ?").get(id);
        const nextAttempts = (row?.attempts ?? 0) + 1;
        const nextStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
        db().prepare(`
      UPDATE friction_queue
      SET    status = ?, attempts = ?, last_error = ?
      WHERE  id = ?
    `).run(nextStatus, nextAttempts, error, id);
    }
    catch (err) {
        process.stderr.write(`[friction-queue] markFailed failed: ${String(err)}\n`);
    }
}
/**
 * Delete submitted entries older than `keepDays` to keep the DB small.
 */
export function pruneSubmitted(keepDays = 30) {
    try {
        const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
        const result = db().prepare(`
      DELETE FROM friction_queue
      WHERE  status = 'submitted' AND submitted_at < ?
    `).run(cutoff);
        return result.changes;
    }
    catch {
        return 0;
    }
}
/**
 * Total counts by status — useful for CLI status display.
 */
export function queueStats() {
    try {
        const rows = db().prepare("SELECT status, COUNT(*) AS cnt FROM friction_queue GROUP BY status").all();
        const stats = { pending: 0, submitted: 0, failed: 0 };
        for (const r of rows)
            stats[r.status] = r.cnt;
        return stats;
    }
    catch {
        return { pending: 0, submitted: 0, failed: 0 };
    }
}
//# sourceMappingURL=queue.js.map