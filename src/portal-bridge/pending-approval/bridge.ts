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

import { buildPendingApprovalPayload, type PendingApprovalInput } from "./payload.js";
import {
  interpretDecision,
  selectDecisionForStepAndCycle,
  type ApprovalDecisionEntry,
} from "./decision.js";
import { emitPendingApproval, pollApprovalDecision, type EmitResult } from "./transport.js";

/** Why the bridge degraded to Core's local approval flow for a gate. */
export type BridgeFallbackReason =
  | "emit_failed" // could not POST the gate (validation/network/non-2xx)
  | "unreachable" // a poll failed (network/abort/http_*) - treat as no decision
  | "malformed" // a poll returned an unparseable body
  | "expired" // the gate's TTL elapsed server-side with no decision
  | "timeout"; // the local wait budget elapsed while still pending

export type BridgeOutcome =
  // Remote approve - NECESSARY, NOT SUFFICIENT. Caller MUST re-validate locally.
  | {
      readonly kind: "approved";
      readonly entry: ApprovalDecisionEntry;
      readonly requiresLocalRevalidation: true;
    }
  // Remote reject - reject the step at Core's gate (as a local human reject).
  | { readonly kind: "rejected"; readonly entry: ApprovalDecisionEntry }
  // Core itself retracted the gate (withdraw echo) - reconcile locally.
  | { readonly kind: "withdrawn" }
  // Degrade to Core's existing local approval flow (never auto-approve).
  | { readonly kind: "fallback_local"; readonly reason: BridgeFallbackReason; readonly detail?: string };

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

// Recommended defaults (Core policy; the contract specifies ranges only).
const DEFAULT_EMIT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_BUDGET_MS = 300_000; // 5 minutes

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort withdraw of a previously emitted gate (INV-LA-WD1 / INV-LA-WD2).
 * Never throws; a failed withdraw does not change the local fallback path.
 * A withdraw that races a terminal human decision does not override it — Portal
 * enforces INV-PAB-I3; Core honors any terminal decision via the normal path.
 */
export async function withdrawPendingApprovalGate(
  input: PendingApprovalInput,
  opts: Pick<BridgeOptions, "url" | "token" | "fetchImpl" | "emitTimeoutMs">,
): Promise<EmitResult> {
  const payload = buildPendingApprovalPayload({ ...input, withdraw: true });
  return emitPendingApproval(payload, {
    url: opts.url,
    token: opts.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    timeoutMs: opts.emitTimeoutMs ?? DEFAULT_EMIT_TIMEOUT_MS,
  });
}

/**
 * Open a remote gate and await the human decision. Emit -> poll -> timeout;
 * on post-emit local fallback, best-effort withdraw (INV-LA-WD1). The returned
 * BridgeOutcome is the SOLE product of this function - acting on it is the
 * caller's job, behind Core's gate. No execution authority here.
 */
export async function runPendingApprovalBridge(
  input: PendingApprovalInput,
  opts: BridgeOptions,
): Promise<BridgeOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const waitBudgetMs = opts.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS;

  const transportBase = {
    url: opts.url,
    token: opts.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  };

  // 1. EMIT. A pending gate is opened; withdraw is never set here (this opens, it
  //    does not retract). An emit failure degrades to local approval (INV-LA-EMIT3)
  //    - it never blocks the run on an unreachable Portal and never auto-approves.
  //    No withdraw on emit_failed: the gate was never opened on Portal.
  const payload = buildPendingApprovalPayload({ ...input, withdraw: false });
  const emit = await emitPendingApproval(payload, {
    ...transportBase,
    timeoutMs: opts.emitTimeoutMs ?? DEFAULT_EMIT_TIMEOUT_MS,
  });
  if (!emit.ok) {
    return { kind: "fallback_local", reason: "emit_failed", detail: emit.reason };
  }

  // After a successful emit, any local-fallback path must withdraw so Portal
  // stops showing the live gate (INV-LA-WD1). Best-effort; never blocks fallback.
  const fallbackAfterEmit = async (
    reason: Exclude<BridgeFallbackReason, "emit_failed">,
    detail?: string,
  ): Promise<BridgeOutcome> => {
    await withdrawPendingApprovalGate(input, {
      url: opts.url,
      token: opts.token,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.emitTimeoutMs !== undefined ? { emitTimeoutMs: opts.emitTimeoutMs } : {}),
    });
    return detail === undefined
      ? { kind: "fallback_local", reason }
      : { kind: "fallback_local", reason, detail };
  };

  // 2. POLL until decided, expired/withdrawn, or the wait budget elapses.
  const start = now();
  const stepIndex = payload.step_index;

  // First poll happens immediately; subsequent polls wait pollIntervalMs, always
  // bounded by waitBudgetMs (never block forever - INV-LA-POLL2/AUTH3).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const poll = await pollApprovalDecision(payload.run_id, {
      ...transportBase,
      timeoutMs: opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
    });

    if (!poll.ok) {
      // Unreachable or malformed => fail closed to local approval. A contract
      // violation (unparseable body) is reported distinctly from a network error.
      const malformed = poll.reason.startsWith("malformed_response");
      return fallbackAfterEmit(
        malformed ? "malformed" : "unreachable",
        poll.reason,
      );
    }

    // P3 Phase 2: when this bridge emitted a non-zero gate cycle (advisory
    // re-open), poll for exactly that cycle's entry; the cycle-0 decision must
    // never satisfy the supersession gate.
    const gateCycle = payload.gate_cycle ?? 0;
    const entry = selectDecisionForStepAndCycle(poll.response, stepIndex, gateCycle);
    const directive = interpretDecision(entry);

    switch (directive.kind) {
      case "approved":
        // entry is non-null whenever the status is approved.
        return { kind: "approved", entry: entry as ApprovalDecisionEntry, requiresLocalRevalidation: true };
      case "rejected":
        return { kind: "rejected", entry: entry as ApprovalDecisionEntry };
      case "withdrawn":
        // Already retracted upstream — do not re-POST withdraw.
        return { kind: "withdrawn" };
      case "fallback_local":
        // Server-side TTL expiry: no decision, degrade to local approval.
        return fallbackAfterEmit("expired");
      case "wait":
        break; // fall through to the budget check + sleep
    }

    // Still pending (or not yet listed). Stop if the budget is exhausted or the
    // next interval would overrun it; otherwise wait and poll again.
    const elapsed = now() - start;
    if (elapsed + pollIntervalMs >= waitBudgetMs) {
      return fallbackAfterEmit("timeout");
    }
    await sleep(pollIntervalMs);
  }
}
