/**
 * Cursor Delivery Gate — the boundary between UseSteady's authority system and Cursor.
 *
 * ── Role ───────────────────────────────────────────────────────────────────────
 *
 *   The delivery gate is the ONLY path through which a CursorHandoffArtifact
 *   reaches Cursor. It enforces three invariants before any delivery occurs:
 *
 *     1. Eligibility check: artifact.eligibility === "approved_for_cursor"
 *     2. Persistence: ucp.cursor_handoff.v1 persisted before Cursor is called
 *     3. Immutability: artifact delivered === artifact persisted (same id)
 *
 *   After delivery, it persists either ucp.cursor_receipt.v1 (accepted) or
 *   ucp.cursor_refused.v1 (refused) based on Cursor's response.
 *
 * ── Delivery mechanism ─────────────────────────────────────────────────────────
 *
 *   Currently: function call via injected CursorEditorPlugin.
 *   This is the mechanism-agnostic contract: the same shapes apply regardless
 *   of transport (function call, IPC, file drop, CLI pipe).
 *
 *   The plugin is injected at construction time so that:
 *     - Tests can inject a stub plugin without coupling to Cursor internals
 *     - The transport can be replaced without changing this module
 *
 * ── Three delivery paths ───────────────────────────────────────────────────────
 *
 *   Path A (happy):    persist handoff → call Cursor → accepted → persist receipt
 *   Path B (scope):    persist handoff → call Cursor → refused_due_to_scope
 *                        → persist refused → surface scope question
 *   Path C (error):    persist handoff → call Cursor → refused_due_to_execution_error
 *                        → persist refused → rejected
 *
 * ── Cursor plugin contract ─────────────────────────────────────────────────────
 *
 *   CursorEditorPlugin.receive() is the only call the gate makes into Cursor.
 *   The plugin must:
 *     - Accept only CursorDeliveryRequest
 *     - Return only CursorResponse (one of three kinds)
 *     - NOT reach back into the intake pipeline
 *     - NOT call persistEnvelope (the gate owns all persistence)
 *
 * ── deliveryId semantics ───────────────────────────────────────────────────────
 *
 *   deliveryId is a delivery-attempt identifier, NOT a content identifier.
 *   It is unique per attempt. Never use it for provenance chain links —
 *   use artifact.id for those. See cursor-delivery-contract.md section 8.
 *
 * See: docs/cursor-delivery-contract.md — full delivery contract
 *      docs/cursor-integration-architecture.md — boundary rules R1–R9
 */
import { hashObject } from "../ucp/hashes.js";
import { persistEnvelope, persistEnvelopeOrThrow } from "../ucp/persistence/write.js";
import { createCursorHandoffEnvelope, createCursorReceiptEnvelope, createCursorRefusedEnvelope, } from "../ucp/envelope.js";
// ─── Delivery gate ────────────────────────────────────────────────────────────
export class CursorDeliveryGate {
    plugin;
    storeDir;
    persistStrict;
    persistBestEffort;
    constructor(plugin, storeDir, deps = {}) {
        this.plugin = plugin;
        this.storeDir = storeDir;
        this.persistStrict = deps.persistStrict
            ?? ((e) => persistEnvelopeOrThrow(storeDir, e));
        this.persistBestEffort = deps.persistBestEffort
            ?? ((e) => persistEnvelope(storeDir, e));
    }
    /**
     * Deliver a CursorHandoffArtifact to Cursor.
     *
     * CONTRACT — callers must ensure:
     *   - artifact.eligibility === "approved_for_cursor" (gate re-checks and blocks if not)
     *   - artifact.ocdClearance.status is "cleared" or "conflict_accepted"
     *   - artifact.approvedAt is set (H has confirmed)
     *
     * CONTRACT — this function guarantees:
     *   - ucp.cursor_handoff.v1 is persisted BEFORE Cursor is called
     *   - If persistence fails, Cursor is NOT called (blocked_persistence_failure)
     *   - ucp.cursor_receipt.v1 is persisted when Cursor returns "accepted"
     *   - ucp.cursor_refused.v1 is persisted when Cursor returns either refusal
     *   - Receipt/refusal persistence failures are logged but do not block state transitions
     *     (Cursor has already taken a position; the gate cannot undo that)
     *
     * @param artifact  The approved CursorHandoffArtifact to deliver.
     * @returns         DeliveryGateResult describing the delivery outcome.
     */
    async deliver(artifact) {
        // ── Eligibility check (R2 — Boundary Rule 2) ─────────────────────────────
        if (artifact.eligibility !== "approved_for_cursor") {
            return {
                outcome: "blocked_ineligible",
                reason: `Artifact eligibility is "${artifact.eligibility}", not "approved_for_cursor".`,
            };
        }
        const sentAt = Date.now();
        const deliveryId = computeDeliveryId(artifact.id, sentAt);
        // ── Point 1: Persist handoff BEFORE calling Cursor ───────────────────────
        const handoffEnvelope = createCursorHandoffEnvelope({
            intentId: artifact.intentId,
            responseId: artifact.responseId,
            eligibility: "approved_for_cursor",
            ocdStatus: artifact.ocdClearance.status,
            rulesFired: [...artifact.ocdClearance.rulesFired],
            changeCategory: artifact.changeSpec.category,
            scopeAllowedFiles: [...artifact.scopeConstraint.allowedFiles],
            confirmedByHuman: true,
            confirmedAt: artifact.approvedAt ?? sentAt,
        }, { parentId: artifact.responseId, rootId: artifact.intentId });
        try {
            this.persistStrict(handoffEnvelope);
        }
        catch (err) {
            return {
                outcome: "blocked_persistence_failure",
                reason: `Failed to persist ucp.cursor_handoff.v1 before delivery: ${String(err)}`,
            };
        }
        // ── Call Cursor ───────────────────────────────────────────────────────────
        const request = { deliveryId, sentAt, artifact };
        const response = await this.plugin.receive(request);
        // ── Point 2a/2b: Persist based on Cursor's response ──────────────────────
        if (response.kind === "accepted") {
            const receiptEnvelope = createCursorReceiptEnvelope({
                deliveryId: response.deliveryId,
                handoffId: handoffEnvelope.id,
                artifactId: response.artifactId,
                receivedAt: response.receivedAt,
            }, { parentId: handoffEnvelope.id, rootId: artifact.intentId });
            this.tryPersistBestEffort(receiptEnvelope);
            return {
                outcome: "accepted",
                deliveryId,
                handoffEnvelopeId: handoffEnvelope.id,
                receiptEnvelopeId: receiptEnvelope.id,
            };
        }
        if (response.kind === "refused_due_to_scope") {
            const refusedEnvelope = createCursorRefusedEnvelope(buildRefusedPayloadFromScope(response, handoffEnvelope.id, deliveryId), { parentId: handoffEnvelope.id, rootId: artifact.intentId });
            this.tryPersistBestEffort(refusedEnvelope);
            return {
                outcome: "refused_due_to_scope",
                deliveryId,
                handoffEnvelopeId: handoffEnvelope.id,
                refusedEnvelopeId: refusedEnvelope.id,
                scopeQuestion: response.scopeQuestion,
            };
        }
        // refused_due_to_execution_error (or unknown kind — treated as execution error)
        const executionErrorResponse = response.kind === "refused_due_to_execution_error"
            ? response
            : null;
        const refusedEnvelope = createCursorRefusedEnvelope({
            deliveryId: deliveryId,
            handoffId: handoffEnvelope.id,
            artifactId: artifact.id,
            receivedAt: Date.now(),
            refusalKind: "refused_due_to_execution_error",
            ...(executionErrorResponse !== null
                ? { errorCode: executionErrorResponse.errorCode }
                : { errorCode: "delivery_timeout" }),
        }, { parentId: handoffEnvelope.id, rootId: artifact.intentId });
        this.tryPersistBestEffort(refusedEnvelope);
        return {
            outcome: "refused_due_to_execution_error",
            deliveryId,
            handoffEnvelopeId: handoffEnvelope.id,
            refusedEnvelopeId: refusedEnvelope.id,
            errorCode: executionErrorResponse?.errorCode ?? "delivery_timeout",
            detail: executionErrorResponse?.detail ?? "Cursor did not respond.",
        };
    }
    // ── Internal ────────────────────────────────────────────────────────────────
    tryPersistBestEffort(envelope) {
        try {
            this.persistBestEffort(envelope);
        }
        catch {
            console.warn(`[cursor-delivery-gate] Non-critical persistence failed for envelope id=${envelope.id.slice(0, 8)}… type=${envelope.type}`);
        }
    }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Compute a delivery-attempt identifier.
 *
 * IMPORTANT: deliveryId is an ATTEMPT identity, not a content identity.
 * It is unique per delivery attempt, not per artifact.
 * Use artifact.id for provenance chain links and content deduplication.
 * Use deliveryId for transport-level correlation only.
 */
function computeDeliveryId(artifactId, sentAt) {
    return hashObject({ artifactId, sentAt });
}
function buildRefusedPayloadFromScope(response, handoffId, deliveryId) {
    const { scopeQuestion } = response;
    return {
        deliveryId,
        handoffId,
        artifactId: response.artifactId,
        receivedAt: response.receivedAt,
        refusalKind: "refused_due_to_scope",
        scopeQuestionKind: scopeQuestion.questionKind,
        scopeCandidates: [...scopeQuestion.candidates],
        scopeSearchedFor: scopeQuestion.searchedFor,
    };
}
//# sourceMappingURL=delivery-gate.js.map