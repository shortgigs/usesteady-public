/**
 * Minimal Cloudflare KV REST client for the certification adapter.
 *
 * Raw `fetch` only — no Cloudflare SDK. The SDK's success object would be one
 * more executor-provided payload to distrust; the adapter's contract is stated
 * directly over HTTP outcomes.
 *
 * Two operations, nothing else:
 *
 *   kvReadValue  GET /client/v4/accounts/<accountId>/storage/kv/namespaces/<namespaceId>/values/<key>
 *   kvPutValue   PUT (same path), body = the complete JSON value envelope
 *
 * ── NO-CAS CAVEAT (load-bearing) ─────────────────────────────────────────────
 *
 *   `kvPutValue` is UNCONDITIONAL last-write-wins. Cloudflare KV offers no
 *   atomic compare-and-set, no ETag, no per-key version: the write applies
 *   regardless of what the key currently holds. There is no server-side
 *   predicate to refuse a stale write — contrast `postgrestCasWrite`, whose
 *   revision predicate is evaluated by Postgres inside the write statement.
 *   Whether an unseen competing write was silently overwritten is provable
 *   only through the observer's revision envelope (detection), never through
 *   the write path (no prevention).
 *
 * The GET response body is the raw stored value (the JSON envelope) — not the
 * Cloudflare API success envelope. The PUT response body IS the Cloudflare
 * API envelope ({ "success": true, ... }); it is classified by HTTP status
 * and never otherwise trusted: a 2xx from the executor path is invocation
 * evidence only.
 *
 * No credential value is ever logged or returned. Responses are classified,
 * not trusted.
 */

import type { KvCredential, KvValueEnvelope } from "./kv-types.js";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ status: number; bodyText: string }>;

export class KvTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KvTransportError";
  }
}

function valueUrl(cred: KvCredential, namespaceId: string, key: string): string {
  return `${cred.url}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/${encodeURIComponent(key)}`;
}

function headers(cred: KvCredential, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${cred.token}`,
    ...extra,
  };
}

/**
 * Read the raw value at the bound key.
 *
 *   200 — bodyText is the raw stored value (expected: the JSON envelope)
 *   404 — key absent (INCONCLUSIVE on KV: negative-lookup caching is
 *         documented, so absence may be a cached miss, never "write failed")
 *   401/403 — credential rejected
 *   429 — rate limited (transport pacing, not a reality signal)
 */
export async function kvReadValue(
  cred: KvCredential,
  namespaceId: string,
  key: string,
  fetchImpl: FetchLike,
): Promise<{ status: number; bodyText: string }> {
  let res: { status: number; bodyText: string };
  try {
    res = await fetchImpl(valueUrl(cred, namespaceId, key), {
      method: "GET",
      headers: headers(cred),
    });
  } catch (err) {
    throw new KvTransportError(
      `read transport failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { status: res.status, bodyText: res.bodyText };
}

/**
 * Unconditional set-to-value of the complete envelope:
 *
 *   PUT <key> = { field, revision, note }
 *
 * The witness field (`note`) is rewritten with the bound expectation because
 * KV has no partial update — the whole value is replaced. Any observed
 * witness delta after actuation is therefore affirmative evidence of a
 * foreign write, not of this executor.
 *
 * The response is classified by HTTP status alone; the Cloudflare API success
 * envelope in the body is executor-provided and carries no authority.
 */
export async function kvPutValue(
  cred: KvCredential,
  namespaceId: string,
  key: string,
  envelope: KvValueEnvelope,
  fetchImpl: FetchLike,
): Promise<{ status: number }> {
  let res: { status: number; bodyText: string };
  try {
    res = await fetchImpl(valueUrl(cred, namespaceId, key), {
      method: "PUT",
      headers: headers(cred, { "Content-Type": "application/json" }),
      body: JSON.stringify(envelope),
    });
  } catch (err) {
    throw new KvTransportError(
      `write transport failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { status: res.status };
}
