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

import { resolveOutboundFetch } from "../outbound-fetch.js";

import { validateExecutionReturnPayload } from "./build-payload.js";
import type { ExecutionReturnPayloadV1 } from "./types.js";

export type SendResult =
  | { readonly ok: true; readonly status: number; readonly idempotent: boolean }
  | { readonly ok: false; readonly reason: string; readonly status?: number };

export type SendOptions = {
  /** Portal base URL, e.g. https://app.usesteady.dev (no trailing /api/v1/runs). */
  readonly url: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function joinUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/runs`;
}

export async function sendExecutionReturn(
  payload: ExecutionReturnPayloadV1,
  opts: SendOptions,
): Promise<SendResult> {
  // Fail-closed gate: never put an invalid payload on the wire.
  const validation = validateExecutionReturnPayload(payload);
  if (!validation.ok) {
    return { ok: false, reason: `invalid_payload: ${validation.errors.join("; ")}` };
  }

  const fetchFn = resolveOutboundFetch(opts.fetchImpl);
  if (typeof fetchFn !== "function") {
    return { ok: false, reason: "fetch_unavailable" };
  }
  if (!opts.url || !opts.url.trim()) return { ok: false, reason: "no_url" };
  if (!opts.token || !opts.token.trim()) return { ok: false, reason: "no_token" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchFn(joinUrl(opts.url), {
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
    try {
      const body = (await response.json()) as { idempotent?: unknown };
      idempotent = body?.idempotent === true;
    } catch {
      /* body is optional; absence is fine */
    }
    return { ok: true, status: response.status, idempotent };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
