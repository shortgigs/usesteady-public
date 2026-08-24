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
import type { UCPEnvelope } from "../ucp/types.js";
import type { CursorHandoffArtifact, CursorDeliveryRequest, CursorResponse, CursorRefusedDueToScope, CursorRefusedDueToExecutionError } from "./types.js";
/**
 * The interface the delivery gate uses to communicate with Cursor.
 *
 * This is the mechanism-agnostic seam. Implementations may use:
 *   - Direct function calls (same process / module boundary)
 *   - Local IPC (separate process)
 *   - File drop (audit/debug path)
 *
 * The plugin is responsible for:
 *   - Receiving the CursorDeliveryRequest
 *   - Applying the edit within the artifact's scopeConstraint
 *   - Returning exactly one CursorResponse kind
 *   - Emitting ucp.execution_trace.v1 on completion (after accepted)
 *
 * The plugin must NOT:
 *   - Re-derive intent from context
 *   - Reach back to the intake pipeline
 *   - Write files outside allowedFiles (when non-empty)
 *   - Call persistEnvelope (the gate owns all persistence)
 */
export interface CursorEditorPlugin {
    receive(request: CursorDeliveryRequest): Promise<CursorResponse>;
}
export type DeliveryGateResult = {
    readonly outcome: "accepted";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly receiptEnvelopeId: string;
} | {
    readonly outcome: "refused_due_to_scope";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly refusedEnvelopeId: string;
    readonly scopeQuestion: CursorRefusedDueToScope["scopeQuestion"];
} | {
    readonly outcome: "refused_due_to_execution_error";
    readonly deliveryId: string;
    readonly handoffEnvelopeId: string;
    readonly refusedEnvelopeId: string;
    readonly errorCode: CursorRefusedDueToExecutionError["errorCode"];
    readonly detail: string;
} | {
    readonly outcome: "blocked_ineligible";
    readonly reason: string;
} | {
    readonly outcome: "blocked_persistence_failure";
    readonly reason: string;
};
export type CursorGateDeps = {
    /**
     * Persistence function for the critical handoff envelope.
     * MUST throw on failure — a failure blocks delivery entirely.
     * Default: persistEnvelopeOrThrow(storeDir, envelope)
     */
    persistStrict?: (envelope: UCPEnvelope<unknown>) => void;
    /**
     * Persistence function for non-critical envelopes (receipt, refused).
     * Must NOT throw — errors are swallowed and logged.
     * Default: persistEnvelope(storeDir, envelope)
     */
    persistBestEffort?: (envelope: UCPEnvelope<unknown>) => void;
};
export declare class CursorDeliveryGate {
    private readonly plugin;
    private readonly storeDir;
    private readonly persistStrict;
    private readonly persistBestEffort;
    constructor(plugin: CursorEditorPlugin, storeDir: string, deps?: CursorGateDeps);
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
    deliver(artifact: CursorHandoffArtifact): Promise<DeliveryGateResult>;
    private tryPersistBestEffort;
}
//# sourceMappingURL=delivery-gate.d.ts.map