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

import { resolveOutboundFetch } from "../outbound-fetch.js";

import { validatePendingApprovalPayload, type PendingApprovalPayloadV1 } from "./payload.js";
import {
  parseApprovalDecisionResponse,
  type ApprovalDecisionResponseV1,
} from "./decision.js";

export type EmitResult =
  | { readonly ok: true; readonly status: number; readonly idempotent: boolean; readonly withdrawn: boolean }
  | { readonly ok: false; readonly reason: string; readonly status?: number };

export type PollResult =
  | { readonly ok: true; readonly status: number; readonly response: ApprovalDecisionResponseV1 }
  | { readonly ok: false; readonly reason: string; readonly status?: number };

export type TransportOptions = {
  /** Portal base URL, e.g. https://app.usesteady.dev (no trailing path). */
  readonly url: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}
function emitUrl(base: string): string {
  return `${trimBase(base)}/api/v1/pending-approvals`;
}
function decisionsUrl(base: string, runId: string): string {
  return `${trimBase(base)}/api/v1/pending-approvals/decisions?run_id=${encodeURIComponent(runId)}`;
}

function resolveFetch(opts: TransportOptions): typeof fetch | null {
  const fetchFn = resolveOutboundFetch(opts.fetchImpl);
  return typeof fetchFn === "function" ? fetchFn : null;
}

/**
 * POST a `ucp.pending_approval.v1` payload to open (or, with withdraw:true,
 * retract) a gate. Validate-first and never-throw. Idempotent on the server by
 * `(org, run_id, step_index)` (INV-PAB-I1) - a repeat returns `idempotent: true`.
 */
export async function emitPendingApproval(
  payload: PendingApprovalPayloadV1,
  opts: TransportOptions,
): Promise<EmitResult> {
  // Fail-closed gate: never put an invalid payload on the wire.
  const validation = validatePendingApprovalPayload(payload);
  if (!validation.ok) {
    return { ok: false, reason: `invalid_payload: ${validation.errors.join("; ")}` };
  }

  const fetchFn = resolveFetch(opts);
  if (!fetchFn) return { ok: false, reason: "fetch_unavailable" };
  if (!opts.url || !opts.url.trim()) return { ok: false, reason: "no_url" };
  if (!opts.token || !opts.token.trim()) return { ok: false, reason: "no_token" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchFn(emitUrl(opts.url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}`, status: response.status };
    }

    let idempotent = false;
    let withdrawn = false;
    try {
      const body = (await response.json()) as { idempotent?: unknown; withdrawn?: unknown };
      idempotent = body?.idempotent === true;
      withdrawn = body?.withdrawn === true;
    } catch {
      /* body is optional; absence is fine */
    }
    return { ok: true, status: response.status, idempotent, withdrawn };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET the run's decision list and parse it as `ucp.approval_decision.v1`.
 * Never-throw; a non-2xx is `http_<status>`, a body that fails to parse is
 * `malformed_response: ...` (the orchestrator treats either as a reason to fall
 * back to local approval - never as an approval).
 */
export async function pollApprovalDecision(
  runId: string,
  opts: TransportOptions,
): Promise<PollResult> {
  const fetchFn = resolveFetch(opts);
  if (!fetchFn) return { ok: false, reason: "fetch_unavailable" };
  if (!opts.url || !opts.url.trim()) return { ok: false, reason: "no_url" };
  if (!opts.token || !opts.token.trim()) return { ok: false, reason: "no_token" };
  if (!runId || !runId.trim()) return { ok: false, reason: "no_run_id" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchFn(decisionsUrl(opts.url, runId), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}`, status: response.status };
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (err) {
      return {
        ok: false,
        reason: `malformed_response: ${err instanceof Error ? err.message : String(err)}`,
        status: response.status,
      };
    }

    const parsed = parseApprovalDecisionResponse(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: `malformed_response: ${parsed.errors.join("; ")}`,
        status: response.status,
      };
    }

    return { ok: true, status: response.status, response: parsed.value };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
