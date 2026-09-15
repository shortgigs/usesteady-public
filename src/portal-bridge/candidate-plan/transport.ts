/**
 * Candidate Plan Bridge (P.S1) - HTTPS transport.
 *
 * `sendCandidatePlan` POSTs a payload to the Portal's
 * `POST /api/v1/candidate-plans` endpoint with the entitlement-derived bearer
 * token. It is:
 *   - VALIDATE-FIRST, FAIL-CLOSED: an invalid payload is never sent.
 *   - BEST-EFFORT: it NEVER throws. Every network/abort/parse error is caught
 *     and returned as a structured result, so a transport failure can never
 *     affect the draft or its later ratification (INV-PS1-2).
 */

import { resolveOutboundFetch } from "../outbound-fetch.js";

import { validateCandidatePlanPayload } from "./build-payload.js";
import type { CandidatePlanPayloadV1 } from "./types.js";

export type SendResult =
  | { readonly ok: true; readonly status: number; readonly idempotent: boolean }
  | { readonly ok: false; readonly reason: string; readonly status?: number };

export type SendOptions = {
  /** Portal base URL, e.g. https://app.usesteady.dev (no /api/v1/candidate-plans). */
  readonly url: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function joinUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/candidate-plans`;
}

export async function sendCandidatePlan(
  payload: CandidatePlanPayloadV1,
  opts: SendOptions,
): Promise<SendResult> {
  // Fail-closed gate: never put an invalid payload on the wire.
  const validation = validateCandidatePlanPayload(payload);
  if (!validation.ok) {
    return { ok: false, reason: `invalid_payload: ${validation.errors.join("; ")}` };
  }

  const fetchFn = resolveOutboundFetch(opts.fetchImpl);
  if (typeof fetchFn !== "function") return { ok: false, reason: "fetch_unavailable" };
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
      const respBody = (await response.json()) as { idempotent?: unknown };
      idempotent = respBody?.idempotent === true;
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
