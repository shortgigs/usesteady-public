/**
 * Phase 3 Lane A (A2) — max UCP handoff `confirmedAt` for local-only approval runs.
 *
 * Mode B only: never supplies approver identity; optional timestamp from persisted
 * delivery handoff envelopes.
 */
import type { SessionChain } from "../../history/types.js";
/**
 * Pure helper: max handoff confirmedAt across audit task sessions, as ISO-8601.
 */
export declare function maxHandoffConfirmedAtFromSessions(sessions: readonly (SessionChain | null)[]): string | null;
/** Read audit record from store and return max handoff confirmedAt (Mode B). */
export declare function maxHandoffConfirmedAtIso(storeDir: string, workflowRunId: string): string | null;
//# sourceMappingURL=handoff-timestamp.d.ts.map