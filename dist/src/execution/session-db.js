/**
 * Execution Control — SQLite persistence layer.
 *
 * Hardening additions (Phase 2 guardrails):
 *   - decided_at column: records exact decision timestamp (observability).
 *   - updateStepDecision: idempotent — returns { updated, alreadyDecided }.
 *   - getSessionStats: lightweight counters for time-to-first-decision,
 *     approval rate, reject rate by action_type, high-risk approval rate.
 *
 * Design rules (mirroring server-store.ts conventions):
 *   1. One singleton DB connection per process.
 *   2. Never throws on schema init — errors propagate to the caller.
 *   3. IDs are generated here (randomUUID), not by the client.
 *   4. system_will is stored as JSON text (SQLite has no native jsonb).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
// ─── Latency classification constants ────────────────────────────────────────
//
// Single source of truth for revert-band thresholds and the rapid-reapproval
// window. Both REVERT_LATENCY and RAPID_REAPPROVAL_SEC live here so the
// DB layer and the log-formatting layer always agree.
//
// Bands:
//   misclick      ≤ MISCLICK_MAX s   → UI ergonomics issue
//   uncertain     ≤ UNCERTAIN_MAX s  → borderline clarity (first-read failure)
//   comprehension > UNCERTAIN_MAX s  → trust or comprehension breakdown
//
// [clarity_friction] fires ONLY when original revert band = 'uncertain'
// AND reapprovalSec ≤ RAPID_REAPPROVAL_SEC. This keeps the signal pure:
// it confirms the user understood on second read, not that they simply changed
// their mind or clicked too fast on a misclick-band revert.
export const REVERT_LATENCY = {
    MISCLICK_MAX: 5, // ≤ 5s
    UNCERTAIN_MAX: 20, // ≤ 20s
};
export const RAPID_REAPPROVAL_SEC = 10;
export function classifyRevertBand(sec) {
    if (sec <= REVERT_LATENCY.MISCLICK_MAX)
        return "misclick";
    if (sec <= REVERT_LATENCY.UNCERTAIN_MAX)
        return "uncertain";
    return "comprehension";
}
let _db = null;
function getDb(storeDir) {
    if (_db)
        return _db;
    mkdirSync(storeDir, { recursive: true });
    _db = new Database(join(storeDir, "execution.db"));
    _db.exec(`
    CREATE TABLE IF NOT EXISTS execution_sessions (
      id             TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      status         TEXT CHECK (status IN ('pending','active','completed','aborted'))
                     DEFAULT 'pending',
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS execution_steps (
      id              TEXT PRIMARY KEY,
      session_id      TEXT REFERENCES execution_sessions(id) ON DELETE CASCADE,
      step_index      INTEGER NOT NULL,
      action_type     TEXT CHECK (action_type IN ('create','update','delete','rename')),
      file_path       TEXT NOT NULL,
      diff            TEXT,
      system_will     TEXT,
      risk_level      TEXT CHECK (risk_level IN ('low','medium','high')),
      why_explanation TEXT,
      status          TEXT CHECK (status IN ('pending','approved','rejected','executed'))
                      DEFAULT 'pending',
      created_at      TEXT DEFAULT (datetime('now')),
      decided_at      TEXT
    );
  `);
    // Migrate existing DBs: add columns if missing (safe no-op if already present).
    try {
        _db.exec(`ALTER TABLE execution_steps ADD COLUMN decided_at TEXT;`);
    }
    catch { /* exists */ }
    // last_reverted_at: timestamp of the most recent revert for this step.
    // Set by undoLastApproval, cleared (set to NULL) when the step is re-approved.
    try {
        _db.exec(`ALTER TABLE execution_steps ADD COLUMN last_reverted_at TEXT;`);
    }
    catch { /* exists */ }
    // last_revert_band: the latency band at the moment of revert ('misclick', 'uncertain', 'comprehension').
    // Travels with the step to the re-approve. [clarity_friction] only fires when this is 'uncertain'.
    // Ensures the signal is self-validating, not heuristic.
    try {
        _db.exec(`ALTER TABLE execution_steps ADD COLUMN last_revert_band TEXT;`);
    }
    catch { /* exists */ }
    // revert_count: feeds hesitation index (revert_count / approved).
    try {
        _db.exec(`ALTER TABLE execution_sessions ADD COLUMN revert_count INTEGER DEFAULT 0;`);
    }
    catch { /* exists */ }
    return _db;
}
export function createSession(storeDir, workspacePath) {
    const id = randomUUID();
    getDb(storeDir)
        .prepare(`INSERT INTO execution_sessions (id, workspace_path, status)
       VALUES (?, ?, 'active')`)
        .run(id, workspacePath);
    return id;
}
export function insertSteps(storeDir, sessionId, steps) {
    const db = getDb(storeDir);
    const stmt = db.prepare(`INSERT INTO execution_steps
       (id, session_id, step_index, action_type, file_path, system_will, risk_level, why_explanation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction((rows) => {
        rows.forEach((step, idx) => {
            stmt.run(step.id, sessionId, idx, step.action_type, step.file_path, JSON.stringify(step.system_will), step.risk_level, step.why_explanation, step.status);
        });
    })(steps);
}
/**
 * Idempotent decision update.
 *
 * Returns:
 *   updated: true         → decision applied, decided_at recorded.
 *   alreadyDecided: true  → step was already decided, no write performed.
 *   rapidReapproval: true → step was reverted and re-approved within
 *                           RAPID_REAPPROVAL_SEC seconds. Signals first-read
 *                           clarity failure (the user understood on re-read).
 *                           Cross-reference with [uncertain] revert band.
 *
 * A step that is already 'approved' or 'rejected' cannot be changed via
 * this function. Any "change decision" path must be a separate, explicit
 * operation (not yet implemented — blocked until Phase 3 undo is scoped).
 */
export function updateStepDecision(storeDir, stepId, decision) {
    const db = getDb(storeDir);
    const row = db
        .prepare(`SELECT status, last_reverted_at, last_revert_band FROM execution_steps WHERE id = ?`)
        .get(stepId);
    if (!row) {
        return { updated: false, alreadyDecided: false, rapidReapproval: false, reapprovalSec: null };
    }
    if (row.status === "approved" || row.status === "rejected") {
        return { updated: false, alreadyDecided: true, previousStatus: row.status, rapidReapproval: false, reapprovalSec: null };
    }
    // Compute re-approve latency if this step was previously reverted.
    let rapidReapproval = false;
    let reapprovalSec = null;
    if (row.last_reverted_at && decision === "approved") {
        try {
            const revertedAt = new Date(row.last_reverted_at.includes("T")
                ? row.last_reverted_at
                : row.last_reverted_at.replace(" ", "T") + "Z").getTime();
            reapprovalSec = Math.round((Date.now() - revertedAt) / 1000);
            // [clarity_friction] only when:
            //   1. original revert band = 'uncertain' (not misclick, not comprehension)
            //   2. re-approve happened within RAPID_REAPPROVAL_SEC
            // This keeps the signal self-validating rather than heuristic.
            rapidReapproval =
                row.last_revert_band === "uncertain" &&
                    reapprovalSec <= RAPID_REAPPROVAL_SEC;
        }
        catch { /* malformed timestamp */ }
    }
    db.prepare(`UPDATE execution_steps
     SET status = ?, decided_at = datetime('now'),
         last_reverted_at = NULL, last_revert_band = NULL
     WHERE id = ?`).run(decision, stepId);
    return { updated: true, alreadyDecided: false, rapidReapproval, reapprovalSec };
}
export function getSessionStats(storeDir, sessionId) {
    const db = getDb(storeDir);
    const session = db
        .prepare(`SELECT created_at, revert_count FROM execution_sessions WHERE id = ?`)
        .get(sessionId);
    const rows = db
        .prepare(`SELECT id, action_type, risk_level, status, decided_at
       FROM execution_steps WHERE session_id = ?`)
        .all(sessionId);
    const decided = rows.filter(r => r.status === "approved" || r.status === "rejected");
    const approved = decided.filter(r => r.status === "approved");
    const rejected = decided.filter(r => r.status === "rejected");
    // Time to first decision
    let timeToFirstDecisionSec = null;
    if (session && decided.length > 0) {
        const firstTs = decided
            .filter(r => r.decided_at)
            .map(r => new Date(r.decided_at).getTime())
            .sort((a, b) => a - b)[0];
        if (firstTs !== undefined) {
            const sessionTs = new Date(session.created_at).getTime();
            timeToFirstDecisionSec = Math.round((firstTs - sessionTs) / 1000);
        }
    }
    // Reject count by action_type — only populated for types that have decided steps.
    // Returns plain counts so the client can render "N rejects" without further math.
    const rejectRateByActionType = {};
    for (const row of rejected) {
        rejectRateByActionType[row.action_type] =
            (rejectRateByActionType[row.action_type] ?? 0) + 1;
    }
    // High-risk approval rate
    const highRiskDecided = decided.filter(r => r.risk_level === "high");
    const highRiskApproved = highRiskDecided.filter(r => r.status === "approved");
    const highRiskApprovalRate = highRiskDecided.length > 0
        ? highRiskApproved.length / highRiskDecided.length
        : null;
    const revertCount = session?.revert_count ?? 0;
    return {
        total: rows.length,
        decided: decided.length,
        approved: approved.length,
        rejected: rejected.length,
        timeToFirstDecisionSec,
        approvalRate: decided.length > 0 ? approved.length / decided.length : null,
        highRiskApprovalRate,
        rejectRateByActionType,
        revertCount,
        // hesitation index: reverts per approval. null when no approvals exist yet.
        hesitationIndex: approved.length > 0 ? revertCount / approved.length : null,
    };
}
/**
 * Returns all decided steps for a session, ordered by decided_at ASC.
 * Only includes steps with status 'approved' or 'rejected'.
 * summary is extracted from system_will.summary for display.
 */
export function getSessionTimeline(storeDir, sessionId) {
    const rows = getDb(storeDir)
        .prepare(`SELECT id, step_index, action_type, file_path, risk_level, status, decided_at, system_will
       FROM execution_steps
       WHERE session_id = ?
         AND status IN ('approved', 'rejected')
         AND decided_at IS NOT NULL
       ORDER BY decided_at ASC`)
        .all(sessionId);
    return rows.map(r => {
        let summary = "";
        try {
            const sw = JSON.parse(r.system_will);
            summary = sw.summary ?? "";
        }
        catch { /* ignore */ }
        return {
            stepId: r.id,
            stepIndex: r.step_index,
            action_type: r.action_type,
            file_path: r.file_path,
            risk_level: r.risk_level,
            decision: r.status,
            decided_at: r.decided_at,
            summary,
        };
    });
}
/**
 * Reverts the most-recently approved step in a session back to 'pending'.
 *
 * Bounded scope:
 *   - Only reverts ONE step per call (caller must explicitly call again to undo more).
 *   - Only reverts 'approved' → 'pending'. Rejected steps are not undone here.
 *   - Clears decided_at so the step re-appears as undecided in the timeline.
 *
 * This is a decision-layer revert, not a filesystem revert. Files have not
 * been written — the approval gate is still in front of execution.
 */
export function undoLastApproval(storeDir, sessionId) {
    const db = getDb(storeDir);
    // Find the most recently approved step (decided_at DESC).
    // Include decided_at so we can compute approve-to-revert latency before clearing it.
    const row = db
        .prepare(`SELECT id, file_path, action_type, decided_at
       FROM execution_steps
       WHERE session_id = ?
         AND status = 'approved'
         AND decided_at IS NOT NULL
       ORDER BY decided_at DESC
       LIMIT 1`)
        .get(sessionId);
    if (!row) {
        return { success: false, reason: "no_approved_steps" };
    }
    // Compute approve-to-revert latency before clearing decided_at.
    let approveToRevertSec = null;
    let revertBand = null;
    if (row.decided_at) {
        try {
            const approvedAt = new Date(row.decided_at.includes("T") ? row.decided_at : row.decided_at.replace(" ", "T") + "Z").getTime();
            approveToRevertSec = Math.round((Date.now() - approvedAt) / 1000);
            revertBand = classifyRevertBand(approveToRevertSec);
        }
        catch { /* malformed timestamp — treat as unknown */ }
    }
    // Store the band on the step so re-approve can validate clarity_friction
    // without re-deriving from timestamps.
    db.prepare(`UPDATE execution_steps
     SET status = 'pending', decided_at = NULL,
         last_reverted_at = datetime('now'), last_revert_band = ?
     WHERE id = ?`).run(revertBand ?? null, row.id);
    // Increment session revert counter — feeds hesitation index.
    db.prepare(`UPDATE execution_sessions
     SET revert_count = revert_count + 1
     WHERE id = ?`).run(sessionId);
    return {
        success: true,
        stepId: row.id,
        file_path: row.file_path,
        action_type: row.action_type,
        approveToRevertSec,
        revertBand,
    };
}
/** Returns the session_id for a given step, or null if not found. */
export function getStepSessionId(storeDir, stepId) {
    const row = getDb(storeDir)
        .prepare(`SELECT session_id FROM execution_steps WHERE id = ?`)
        .get(stepId);
    return row?.session_id ?? null;
}
/**
 * Return all steps for a session ordered by step_index ASC.
 * Ordering is deterministic: step_index is assigned at insert time (0-based)
 * and never mutated, so ORDER BY step_index always matches insertion order.
 */
export function getSessionSteps(storeDir, sessionId) {
    const rows = getDb(storeDir)
        .prepare(`SELECT id, action_type, file_path, system_will, risk_level, why_explanation, status
       FROM execution_steps
       WHERE session_id = ?
       ORDER BY step_index ASC`)
        .all(sessionId);
    return rows.map(r => ({
        id: r.id,
        file_path: r.file_path,
        action_type: r.action_type,
        system_will: JSON.parse(r.system_will),
        risk_level: r.risk_level,
        why_explanation: r.why_explanation,
        status: r.status,
    }));
}
//# sourceMappingURL=session-db.js.map