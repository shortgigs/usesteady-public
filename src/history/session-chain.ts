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
import type {
  UCPEnvelope,
  CursorHandoffPayload,
  CursorReceiptPayload,
  CursorRefusedPayload,
  ClaudeHandoffPayload,
  ClaudeReceiptPayload,
  ClaudeRefusedPayload,
  IntentPayload,
} from "../ucp/types.js";
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
export function buildSessionChain(
  storeDir: string,
  intentId: string,
): SessionChain {
  const chain = getChain(storeDir, intentId);

  let intent:        UCPEnvelope<IntentPayload>       | null = null;
  let responseId:    string | null                           = null;
  let cursorHandoff: UCPEnvelope<CursorHandoffPayload> | null = null;
  let cursorReceipt: UCPEnvelope<CursorReceiptPayload> | null = null;
  let cursorRefused: UCPEnvelope<CursorRefusedPayload> | null = null;
  let claudeHandoff: UCPEnvelope<ClaudeHandoffPayload> | null = null;
  let claudeReceipt: UCPEnvelope<ClaudeReceiptPayload> | null = null;
  let claudeRefused: UCPEnvelope<ClaudeRefusedPayload> | null = null;

  for (const env of chain) {
    switch (env.type) {
      case "ucp.intent.v1":
        intent = env as UCPEnvelope<IntentPayload>;
        break;
      case "ucp.response.v1":
        // Capture the response envelope id for SessionChain.responseId.
        responseId = env.id;
        break;
      case "ucp.cursor_handoff.v1":
        cursorHandoff = env as UCPEnvelope<CursorHandoffPayload>;
        break;
      case "ucp.cursor_receipt.v1":
        cursorReceipt = env as UCPEnvelope<CursorReceiptPayload>;
        break;
      case "ucp.cursor_refused.v1":
        cursorRefused = env as UCPEnvelope<CursorRefusedPayload>;
        break;
      case "ucp.claude_handoff.v1":
        claudeHandoff = env as UCPEnvelope<ClaudeHandoffPayload>;
        break;
      case "ucp.claude_receipt.v1":
        claudeReceipt = env as UCPEnvelope<ClaudeReceiptPayload>;
        break;
      case "ucp.claude_refused.v1":
        claudeRefused = env as UCPEnvelope<ClaudeRefusedPayload>;
        break;
      // Other envelope types (ucp.artifact.v1 etc.) are not SessionChain members.
    }
  }

  const runtime: SessionChain["runtime"] =
    cursorHandoff !== null ? "cursor" :
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
