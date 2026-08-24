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
import type { QueueEntry, FrictionEvent, QueueStatus } from "./types.js";
/**
 * Add a new friction event to the queue.
 * Called synchronously (no await) from auto-capture hooks so the
 * core workflow path is never delayed.
 */
export declare function enqueue(event: FrictionEvent): string;
/**
 * Return all entries with the given status.
 */
export declare function listByStatus(status: QueueStatus): QueueEntry[];
/**
 * Return pending entries older than `olderThanMs` milliseconds,
 * up to `limit`. Used by the flush loop to pick retry candidates.
 */
export declare function pendingEntries(limit?: number): QueueEntry[];
/**
 * Mark an entry as successfully submitted.
 */
export declare function markSubmitted(id: string): void;
export declare function markFailed(id: string, error: string): void;
/**
 * Delete submitted entries older than `keepDays` to keep the DB small.
 */
export declare function pruneSubmitted(keepDays?: number): number;
/**
 * Total counts by status — useful for CLI status display.
 */
export declare function queueStats(): Record<QueueStatus, number>;
//# sourceMappingURL=queue.d.ts.map