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
import type { UCPEnvelope } from "../types.js";
export declare const LOG_FILENAME = "envelopes.log";
export declare const INDEX_FILENAME = "index.json";
/**
 * UCPIndex — lightweight projection of the log file.
 *
 * byId     — envelope id → byte offset in envelopes.log (seek position)
 * byType   — envelope type → [id, ...] (insertion order)
 * byRoot   — refs.rootId → [id, ...] (all envelopes in this intent chain)
 * byParent — refs.parentId → [id, ...] (direct children of a parent envelope)
 */
export type UCPIndex = {
    readonly byId: Record<string, number>;
    readonly byType: Record<string, string[]>;
    readonly byRoot: Record<string, string[]>;
    readonly byParent: Record<string, string[]>;
};
export declare function emptyIndex(): UCPIndex;
export declare function ensureStoreDir(storeDir: string): void;
/**
 * Append one envelope to the JSONL log.
 * Returns the byte offset at which the envelope was written
 * (i.e., the file size before the append).
 *
 * Uses stableStringify — output is canonical and deterministic.
 * Same envelope always produces the same bytes.
 */
export declare function appendEnvelope(storeDir: string, envelope: UCPEnvelope<unknown>): number;
/**
 * Load the index from disk. Returns an empty index if the file does not exist
 * or cannot be parsed.
 */
export declare function loadIndex(storeDir: string): UCPIndex;
/**
 * Add one envelope's index entries and atomically write the updated index.
 *
 * First-write-wins for byId: if the envelope id is already present, the stored
 * offset is not overwritten. All other indexes (byType, byRoot, byParent) always
 * append the id, preserving insertion order.
 */
export declare function updateIndex(storeDir: string, envelope: UCPEnvelope<unknown>, offset: number): void;
/**
 * Rebuild the entire index by scanning the log file from the beginning.
 * Corrupt or unparseable lines are skipped with a console.warn.
 * The rebuilt index is written atomically and returned.
 *
 * Use this when:
 *   - index.json is missing or corrupt
 *   - the log and index are suspected to be out of sync
 */
export declare function rebuildIndex(storeDir: string): UCPIndex;
//# sourceMappingURL=store.d.ts.map