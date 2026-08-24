/**
 * UCP Persistence Store — raw file operations.
 *
 * Provides append-only JSONL logging and a lightweight JSON index for
 * UCP envelopes. All operations are synchronous, deterministic, and
 * filesystem-only — no database, no network, no async queues.
 *
 * ── File layout ──────────────────────────────────────────────────────────────
 *
 *   <storeDir>/
 *     envelopes.log    # append-only JSONL — one envelope per line
 *     index.json       # lightweight in-memory index (rebuildable)
 *     index.json.tmp   # transient during atomic index write (never left behind)
 *
 * ── Design invariants ────────────────────────────────────────────────────────
 *
 *   1. The log is append-only. Lines are never rewritten or deleted.
 *   2. Each line is stableStringify(envelope) — canonical, deterministic bytes.
 *   3. The index is a projection of the log. It can always be rebuilt from scratch.
 *   4. Index writes are atomic: write to .tmp, then rename. No partial index state.
 *   5. Duplicate envelope ids are tolerated: second occurrence does not overwrite
 *      the first in byId (first-write-wins for offset).
 *   6. Corrupt lines in the log are skipped silently during rebuild.
 *   7. This module has ZERO authority. It never affects mode, execution, or replay.
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync, statSync, } from "fs";
import { join } from "path";
import { stableStringify } from "../hashes.js";
// ─── Constants ────────────────────────────────────────────────────────────────
export const LOG_FILENAME = "envelopes.log";
export const INDEX_FILENAME = "index.json";
export function emptyIndex() {
    return { byId: {}, byType: {}, byRoot: {}, byParent: {} };
}
// ─── Directory setup ──────────────────────────────────────────────────────────
export function ensureStoreDir(storeDir) {
    if (!existsSync(storeDir)) {
        mkdirSync(storeDir, { recursive: true });
    }
}
// ─── Log operations ───────────────────────────────────────────────────────────
/**
 * Append one envelope to the JSONL log.
 * Returns the byte offset at which the envelope was written
 * (i.e., the file size before the append).
 *
 * Uses stableStringify — output is canonical and deterministic.
 * Same envelope always produces the same bytes.
 */
export function appendEnvelope(storeDir, envelope) {
    ensureStoreDir(storeDir);
    const logPath = join(storeDir, LOG_FILENAME);
    const line = stableStringify(envelope) + "\n";
    let offset = 0;
    if (existsSync(logPath)) {
        offset = statSync(logPath).size;
    }
    appendFileSync(logPath, line, "utf8");
    return offset;
}
// ─── Index operations ─────────────────────────────────────────────────────────
/**
 * Load the index from disk. Returns an empty index if the file does not exist
 * or cannot be parsed.
 */
export function loadIndex(storeDir) {
    const indexPath = join(storeDir, INDEX_FILENAME);
    if (!existsSync(indexPath))
        return emptyIndex();
    try {
        return JSON.parse(readFileSync(indexPath, "utf8"));
    }
    catch {
        return emptyIndex();
    }
}
/**
 * Add one envelope's index entries and atomically write the updated index.
 *
 * First-write-wins for byId: if the envelope id is already present, the stored
 * offset is not overwritten. All other indexes (byType, byRoot, byParent) always
 * append the id, preserving insertion order.
 */
export function updateIndex(storeDir, envelope, offset) {
    const index = loadIndex(storeDir);
    const next = addToIndex(index, envelope, offset);
    writeIndexAtomic(storeDir, next);
}
/**
 * Rebuild the entire index by scanning the log file from the beginning.
 * Corrupt or unparseable lines are skipped with a console.warn.
 * The rebuilt index is written atomically and returned.
 *
 * Use this when:
 *   - index.json is missing or corrupt
 *   - the log and index are suspected to be out of sync
 */
export function rebuildIndex(storeDir) {
    const logPath = join(storeDir, LOG_FILENAME);
    if (!existsSync(logPath)) {
        const empty = emptyIndex();
        writeIndexAtomic(storeDir, empty);
        return empty;
    }
    const raw = readFileSync(logPath, "utf8");
    const lines = raw.split("\n");
    let index = emptyIndex();
    let byteOffset = 0;
    for (const line of lines) {
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (line.trim() !== "") {
            try {
                const envelope = JSON.parse(line);
                index = addToIndex(index, envelope, byteOffset);
            }
            catch {
                console.warn(`[ucp-persist] rebuildIndex: skipping corrupt line at offset ${byteOffset}`);
            }
        }
        // Each line in the log ends with \n — account for it.
        byteOffset += lineBytes + 1;
    }
    writeIndexAtomic(storeDir, index);
    return index;
}
// ─── Internal helpers ─────────────────────────────────────────────────────────
/**
 * Pure function — returns a new UCPIndex with the envelope's entries added.
 * Does not mutate the input index.
 */
function addToIndex(index, envelope, offset) {
    const byId = { ...index.byId };
    const byType = { ...index.byType };
    const byRoot = { ...index.byRoot };
    const byParent = { ...index.byParent };
    // byId — first-write-wins: preserve the offset of the first occurrence.
    if (!(envelope.id in byId)) {
        byId[envelope.id] = offset;
    }
    // byType
    if (!byType[envelope.type])
        byType[envelope.type] = [];
    if (!byType[envelope.type].includes(envelope.id)) {
        byType[envelope.type] = [...byType[envelope.type], envelope.id];
    }
    // byRoot (only if refs.rootId present)
    const rootId = envelope.refs?.rootId;
    if (rootId) {
        if (!byRoot[rootId])
            byRoot[rootId] = [];
        if (!byRoot[rootId].includes(envelope.id)) {
            byRoot[rootId] = [...byRoot[rootId], envelope.id];
        }
    }
    // byParent (only if refs.parentId present)
    const parentId = envelope.refs?.parentId;
    if (parentId) {
        if (!byParent[parentId])
            byParent[parentId] = [];
        if (!byParent[parentId].includes(envelope.id)) {
            byParent[parentId] = [...byParent[parentId], envelope.id];
        }
    }
    return { byId, byType, byRoot, byParent };
}
/**
 * Atomically write index to disk: write to a .tmp file, then rename.
 * This guarantees the index is never left in a partial state.
 */
function writeIndexAtomic(storeDir, index) {
    ensureStoreDir(storeDir);
    const indexPath = join(storeDir, INDEX_FILENAME);
    const tmpPath = indexPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(index, null, 2), "utf8");
    renameSync(tmpPath, indexPath);
}
//# sourceMappingURL=store.js.map