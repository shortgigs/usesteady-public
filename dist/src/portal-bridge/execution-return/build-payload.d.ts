/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - pure payload builder.
 *
 * `buildExecutionReturnPayload` takes an already-extracted, already-redacted
 * normalized input and produces a frozen, bounds-enforced `ucp.execution_return.v1`
 * wire payload. It is PURE: no network, no filesystem, no clock, no env reads.
 * (Mapping UCP + execution.db into `ExecutionReturnInput`, applying the on-machine
 * redaction allowlist, and the actual HTTPS POST are the next P0-49 step - kept
 * out of this unit so the wire shape can be tested in isolation.)
 *
 * `validateExecutionReturnPayload` is the fail-closed gate the transport step
 * will call BEFORE sending: a payload that does not validate is never POSTed.
 * It mirrors the Portal-side 400 contract so both lanes agree on "well-typed".
 *
 * Privacy: the input type carries no contents/diffs (INV-ERB-P2); resources are
 * assumed already redacted on the machine (INV-ERB-P3) before reaching here.
 */
import { type ExecutionOutcome, type ExecutionReturnAffectedResource, type ExecutionReturnApprovalRecord, type ExecutionReturnDecisionSummary, type ExecutionReturnDeliveryReportSummary, type ExecutionReturnPayloadV1, type ExecutionReturnReplayRef, type ExecutionReturnChainVerification, type ExecutionReturnResumeTokenMeta, type ExecutionReturnOutcomeVerification } from "./types.js";
/**
 * Normalized, lane-internal input. Camel-case (Core convention); the builder
 * maps it to the snake_case wire shape. Resources must already be redacted.
 */
export type ExecutionReturnInput = {
    readonly runId: string;
    readonly ucpRootId: string;
    readonly ucpBundleHash?: string | null;
    readonly workflowName?: string | null;
    readonly outcome: ExecutionOutcome;
    /** ISO-8601, Core clock (ordering authority - INV-ERB-I3). */
    readonly executedAt: string;
    readonly decisionSummary: ExecutionReturnDecisionSummary;
    /** Additive Feature 2.2. Omitted from the wire when absent. */
    readonly deliveryReportSummary?: ExecutionReturnDeliveryReportSummary | null;
    readonly approvalRecord: ExecutionReturnApprovalRecord;
    /** Already redacted/allowlisted on the machine before this call (INV-ERB-P3). */
    readonly affectedResources?: readonly ExecutionReturnAffectedResource[];
    readonly resumeTokenMeta?: ExecutionReturnResumeTokenMeta;
    /** Number of records in the full chain (getChain(rootId).length). */
    readonly chainCount: number;
    /** Defaults to (chainCount > 0) when omitted. */
    readonly chainAvailable?: boolean;
    /**
     * Optional (P0-55) kernel-replay reference. Omitted from the wire when null/
     * undefined. When `reconstructable` is true, `checksum` must be a non-empty
     * content address (enforced by validateExecutionReturnPayload).
     */
    readonly replayRef?: ExecutionReturnReplayRef | null;
    /**
     * Optional (P0-57) chain-verification block (ordered content-hash ids + digest).
     * Omitted from the wire when null/undefined or when entry_ids is empty.
     */
    readonly chainVerification?: ExecutionReturnChainVerification | null;
    /** P6 V1 — independent outcome verification. Omitted when absent. */
    readonly outcomeVerification?: ExecutionReturnOutcomeVerification | null;
};
/**
 * Build the frozen wire payload from normalized input.
 *
 * Bounds rule (contract "Bounds & rules"): when `affectedResources` exceeds
 * AFFECTED_RESOURCES_LIMIT, only the first N are carried, `*_truncated` is true,
 * and `*_total` holds the true pre-truncation count.
 */
export declare function buildExecutionReturnPayload(input: ExecutionReturnInput): ExecutionReturnPayloadV1;
export type PayloadValidation = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};
/**
 * Fail-closed validation. The transport step must call this before POSTing and
 * must NOT send when `ok === false`. Mirrors the Portal-side 400 contract so a
 * payload this function accepts is one the Portal endpoint will accept on type
 * grounds (auth + idempotency are separate, server-side concerns).
 */
export declare function validateExecutionReturnPayload(payload: ExecutionReturnPayloadV1): PayloadValidation;
//# sourceMappingURL=build-payload.d.ts.map