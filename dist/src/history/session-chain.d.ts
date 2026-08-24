/**
 * Phase 10B: SessionChain builder.
 *
 * Resolves a SessionChain for a single Phase 8/9 task session by navigating
 * the UCP store via the existing byRoot index.
 *
 * ── Navigation ────────────────────────────────────────────────────────────────
 *
 *   getChain(storeDir, intentId) returns the intent envelope plus every envelope
 *   whose refs.rootId === intentId. This covers all Phase 8/9 delivery envelopes
 *   without any new index fields (D3).
 *
 *   Type-switch on env.type classifies each envelope into the SessionChain fields.
 *
 * ── Runtime detection ─────────────────────────────────────────────────────────
 *
 *   cursorHandoff !== null → "cursor"
 *   claudeHandoff !== null → "claude"
 *   neither                → "unknown" (partial record or unknown runtime)
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   Zero. Read-only. No imports from coordinator, sessions, or execution layer.
 */
import type { SessionChain } from "./types.js";
/**
 * Build a SessionChain by resolving all Phase 8/9 delivery envelopes rooted
 * at `intentId` from the UCP store.
 *
 * Uses getChain(storeDir, intentId) — no additional disk reads beyond the
 * chain scan. Returns a SessionChain where absent envelopes are null.
 *
 * Never throws. Returns a fully-null SessionChain on empty or corrupt data.
 */
export declare function buildSessionChain(storeDir: string, intentId: string): SessionChain;
//# sourceMappingURL=session-chain.d.ts.map