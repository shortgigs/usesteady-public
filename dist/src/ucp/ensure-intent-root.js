/**
 * Deterministic ucp.intent.v1 root for raw operator input.
 *
 * Content-addressed id from mapIntentToEnvelope; persisted once per store so
 * getChain() can resolve a provenance chain. Shared by the portal Understand
 * bridge and the CLI FS fast path.
 */
import { mapIntentToEnvelope } from "./mappers/map-intent.js";
import { getEnvelopeById } from "./persistence/query.js";
import { persistEnvelope } from "./persistence/write.js";
export function ensureUcpIntentRoot(storeDir, input) {
    const trimmed = input.trim();
    const envelope = mapIntentToEnvelope(trimmed);
    if (getEnvelopeById(storeDir, envelope.id) === null) {
        persistEnvelope(storeDir, envelope);
    }
    return { ucpRootId: envelope.id };
}
//# sourceMappingURL=ensure-intent-root.js.map