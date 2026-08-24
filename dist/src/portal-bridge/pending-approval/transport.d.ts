/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - HTTPS transport.
 *
 * Two read/write calls, both Core -> Portal (Core PULLS decisions; there is no
 * inbound channel to the machine - Fork 2a):
 *   - emitPendingApproval : POST {base}/api/v1/pending-approvals  (open OR withdraw a gate)
 *   - pollApprovalDecision: GET  {base}/api/v1/pending-approvals/decisions?run_id=...
 *
 * Both are:
 *   - VALIDATE/PARSE-FIRST, FAIL-CLOSED: emit never sends an invalid payload; a
 *     poll body that does not parse is reported as an error (the orchestrator then
 *     degrades to local approval - never auto-approves).
 *   - BEST-EFFORT: they NEVER throw. Every network/abort/parse error is caught and
 *     returned as a structured result, so a transport failure can never advance,
 *     block, or otherwise affect the local approval gate (INV-LA-AUTH3 posture:
 *     the bridge is a side-channel around the gate, not the gate).
 *
 * The bearer token is supplied by the caller (resolved from env/config by the
 * opt-in layer). Core does not issue tokens.
 */
import { type PendingApprovalPayloadV1 } from "./payload.js";
import { type ApprovalDecisionResponseV1 } from "./decision.js";
export type EmitResult = {
    readonly ok: true;
    readonly status: number;
    readonly idempotent: boolean;
    readonly withdrawn: boolean;
} | {
    readonly ok: false;
    readonly reason: string;
    readonly status?: number;
};
export type PollResult = {
    readonly ok: true;
    readonly status: number;
    readonly response: ApprovalDecisionResponseV1;
} | {
    readonly ok: false;
    readonly reason: string;
    readonly status?: number;
};
export type TransportOptions = {
    /** Portal base URL, e.g. https://app.usesteady.dev (no trailing path). */
    readonly url: string;
    readonly token: string;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
};
/**
 * POST a `ucp.pending_approval.v1` payload to open (or, with withdraw:true,
 * retract) a gate. Validate-first and never-throw. Idempotent on the server by
 * `(org, run_id, step_index)` (INV-PAB-I1) - a repeat returns `idempotent: true`.
 */
export declare function emitPendingApproval(payload: PendingApprovalPayloadV1, opts: TransportOptions): Promise<EmitResult>;
/**
 * GET the run's decision list and parse it as `ucp.approval_decision.v1`.
 * Never-throw; a non-2xx is `http_<status>`, a body that fails to parse is
 * `malformed_response: ...` (the orchestrator treats either as a reason to fall
 * back to local approval - never as an approval).
 */
export declare function pollApprovalDecision(runId: string, opts: TransportOptions): Promise<PollResult>;
//# sourceMappingURL=transport.d.ts.map