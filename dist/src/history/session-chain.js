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
import { getChain } from "../ucp/persistence/index.js";
/**
 * Build a SessionChain by resolving all Phase 8/9 delivery envelopes rooted
 * at `intentId` from the UCP store.
 *
 * Uses getChain(storeDir, intentId) — no additional disk reads beyond the
 * chain scan. Returns a SessionChain where absent envelopes are null.
 *
 * Never throws. Returns a fully-null SessionChain on empty or corrupt data.
 */
export function buildSessionChain(storeDir, intentId) {
    const chain = getChain(storeDir, intentId);
    let intent = null;
    let responseId = null;
    let cursorHandoff = null;
    let cursorReceipt = null;
    let cursorRefused = null;
    let claudeHandoff = null;
    let claudeReceipt = null;
    let claudeRefused = null;
    for (const env of chain) {
        switch (env.type) {
            case "ucp.intent.v1":
                intent = env;
                break;
            case "ucp.response.v1":
                // Capture the response envelope id for SessionChain.responseId.
                responseId = env.id;
                break;
            case "ucp.cursor_handoff.v1":
                cursorHandoff = env;
                break;
            case "ucp.cursor_receipt.v1":
                cursorReceipt = env;
                break;
            case "ucp.cursor_refused.v1":
                cursorRefused = env;
                break;
            case "ucp.claude_handoff.v1":
                claudeHandoff = env;
                break;
            case "ucp.claude_receipt.v1":
                claudeReceipt = env;
                break;
            case "ucp.claude_refused.v1":
                claudeRefused = env;
                break;
            // Other envelope types (ucp.artifact.v1 etc.) are not SessionChain members.
        }
    }
    const runtime = cursorHandoff !== null ? "cursor" :
        claudeHandoff !== null ? "claude" :
            "unknown";
    return {
        runtime,
        intentId,
        responseId,
        intent,
        cursorHandoff,
        cursorReceipt,
        cursorRefused,
        claudeHandoff,
        claudeReceipt,
        claudeRefused,
    };
}
//# sourceMappingURL=session-chain.js.map