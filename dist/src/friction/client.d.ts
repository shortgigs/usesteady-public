/**
 * src/friction/client.ts
 *
 * Submits a queued friction entry to the collection backend.
 *
 * The collection endpoint and GitHub token are read from
 * ~/.usesteady/config.json and ~/.usesteady/auth.json respectively.
 * No hardcoded private URLs exist in this file — alpha testers receive
 * a pre-filled config.json out-of-band.
 *
 * Transport: GitHub Issues REST API
 *   POST /repos/{owner}/{repo}/issues
 *   Authorization: Bearer {github_token}
 *
 * The private friction collection repo has triage label
 * automation that routes + tags incoming issues automatically.
 */
import type { FrictionConfig, QueueEntry } from "./types.js";
/**
 * Submit one queue entry to the GitHub Issues collection backend.
 * Returns the created issue number on success, throws on failure.
 */
export declare function submitEntry(entry: QueueEntry, config: FrictionConfig): Promise<number>;
/**
 * Flush all pending queue entries to the collection backend.
 *
 * Designed to be called:
 *  - At server startup (if a token exists)
 *  - After each new enqueue (non-blocking, fire-and-forget)
 *
 * Uses simple linear back-off between entries to avoid rate limiting.
 * Returns the count of successfully submitted entries.
 */
export declare function flushQueue(config: FrictionConfig): Promise<number>;
/**
 * Fire-and-forget flush — called after enqueue() so callers don't need to await.
 */
export declare function scheduleFlush(config: FrictionConfig): void;
//# sourceMappingURL=client.d.ts.map