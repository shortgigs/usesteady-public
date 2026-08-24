/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - orchestrator.
 *
 * `runPendingApprovalBridge` opens a remote gate (emit) and polls for the human's
 * decision until one arrives or the wait budget elapses. On post-emit local
 * fallback it best-effort withdraws the gate (INV-LA-WD1). It carries no
 * execution authority and changes no executor behavior. It returns a
 * BridgeOutcome that the gate hook feeds into Core's EXISTING approval gate.
 *
 * Authority (the crux - INV-LA-AUTH1..4 / INV-LA-ENF1..3):
 *   - The Portal decision is an INPUT, never an execution command.
 *   - `approved` is returned with `requiresLocalRevalidation: true`: the caller
 *     MUST re-validate eligibility at Core's own gate before running the step. The
 *     bridge never approves, executes, skips, or reorders anything.
 *   - FAIL CLOSED, NEVER AUTO-APPROVE: an emit failure, an unreachable/`http_*`
 *     poll, a malformed body, an `expired` gate, or the wait budget elapsing with
 *     no decision all resolve to `fallback_local` - i.e. "use Core's existing
 *     local approval flow for this gate". Silence/absence is never approval.
 *   - A terminal remote decision (`approved`/`rejected`/`withdrawn`) is returned
 *     verbatim; the bridge never overrides it.
 *
 * Purity: no direct clock/sleep dependence - `now`/`sleep` are injectable so the
 * loop is deterministic under test. Network is the injected fetchImpl on the
 * transport calls.
 */
import { type PendingApprovalInput } from "./payload.js";
import { type ApprovalDecisionEntry } from "./decision.js";
import { type EmitResult } from "./transport.js";
/** Why the bridge degraded to Core's local approval flow for a gate. */
export type BridgeFallbackReason = "emit_failed" | "unreachable" | "malformed" | "expired" | "timeout";
export type BridgeOutcome = {
    readonly kind: "approved";
    readonly entry: ApprovalDecisionEntry;
    readonly requiresLocalRevalidation: true;
} | {
    readonly kind: "rejected";
    readonly entry: ApprovalDecisionEntry;
} | {
    readonly kind: "withdrawn";
} | {
    readonly kind: "fallback_local";
    readonly reason: BridgeFallbackReason;
    readonly detail?: string;
};
export type BridgeOptions = {
    readonly url: string;
    readonly token: string;
    readonly fetchImpl?: typeof fetch;
    /** Per-request timeout for the emit POST. */
    readonly emitTimeoutMs?: number;
    /** Per-request timeout for each decision poll GET. */
    readonly pollTimeoutMs?: number;
    /** Delay between polls while the gate is still pending. */
    readonly pollIntervalMs?: number;
    /** Total local wait budget before falling back to local approval. */
    readonly waitBudgetMs?: number;
    /** Injectable clock (ms epoch). Defaults to Date.now. */
    readonly now?: () => number;
    /** Injectable sleep. Defaults to a real setTimeout-based delay. */
    readonly sleep?: (ms: number) => Promise<void>;
};
/**
 * Best-effort withdraw of a previously emitted gate (INV-LA-WD1 / INV-LA-WD2).
 * Never throws; a failed withdraw does not change the local fallback path.
 * A withdraw that races a terminal human decision does not override it — Portal
 * enforces INV-PAB-I3; Core honors any terminal decision via the normal path.
 */
export declare function withdrawPendingApprovalGate(input: PendingApprovalInput, opts: Pick<BridgeOptions, "url" | "token" | "fetchImpl" | "emitTimeoutMs">): Promise<EmitResult>;
/**
 * Open a remote gate and await the human decision. Emit -> poll -> timeout;
 * on post-emit local fallback, best-effort withdraw (INV-LA-WD1). The returned
 * BridgeOutcome is the SOLE product of this function - acting on it is the
 * caller's job, behind Core's gate. No execution authority here.
 */
export declare function runPendingApprovalBridge(input: PendingApprovalInput, opts: BridgeOptions): Promise<BridgeOutcome>;
//# sourceMappingURL=bridge.d.ts.map