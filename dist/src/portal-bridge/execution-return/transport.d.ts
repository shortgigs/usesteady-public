/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - HTTPS transport.
 *
 * `sendExecutionReturn` POSTs a payload to the Portal's `POST /api/v1/runs`
 * endpoint with the entitlement-derived bearer token. It is:
 *   - VALIDATE-FIRST, FAIL-CLOSED: an invalid payload is never sent.
 *   - BEST-EFFORT: it NEVER throws. Every network/abort/parse error is caught
 *     and returned as a structured result, so a transport failure can never
 *     affect the local run (INV-ERB-P1 posture: reporting is a side-channel).
 *
 * The bearer token is supplied by the caller (resolved from env/config). Core
 * does not issue tokens - issuance is a Phase-2 Issuer-side detail per the
 * frozen contract.
 */
import type { ExecutionReturnPayloadV1 } from "./types.js";
export type SendResult = {
    readonly ok: true;
    readonly status: number;
    readonly idempotent: boolean;
} | {
    readonly ok: false;
    readonly reason: string;
    readonly status?: number;
};
export type SendOptions = {
    /** Portal base URL, e.g. https://app.usesteady.dev (no trailing /api/v1/runs). */
    readonly url: string;
    readonly token: string;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
};
export declare function sendExecutionReturn(payload: ExecutionReturnPayloadV1, opts: SendOptions): Promise<SendResult>;
//# sourceMappingURL=transport.d.ts.map