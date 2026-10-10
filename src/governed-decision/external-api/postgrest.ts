/**
 * Minimal PostgREST client for the certification adapter.
 *
 * Raw `fetch` only — no Supabase SDK. The SDK's success object would be one
 * more executor-provided payload to distrust; the adapter's contract is stated
 * directly over HTTP outcomes.
 *
 * Two operations, nothing else:
 *
 *   readRow   GET  /rest/v1/<table>?id=eq.<rowId>&select=<observedFields>
 *   casWrite  PATCH /rest/v1/<table>?id=eq.<rowId>&revision=eq.<priorRevision>
 *             body { field: targetValue, revision: nextRevision }
 *             Prefer: return=representation
 *
 * `casWrite` is the candidate atomic conditional update: the revision
 * predicate is evaluated by Postgres inside the same statement as the write,
 * so a stale predicate matches zero rows and writes nothing. Whether that
 * atomicity holds LIVE is proven empirically by the certification tests
 * (section 10) — never assumed from documentation.
 *
 * No credential value is ever logged or returned. Responses are classified,
 * not trusted: a 2xx from the executor path is invocation evidence only.
 */

import type { ApiCredential } from "./types.js";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ status: number; bodyText: string }>;

export class PostgrestTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgrestTransportError";
  }
}

function restUrl(cred: ApiCredential, table: string, query: string): string {
  return `${cred.url}/rest/v1/${table}?${query}`;
}

function headers(cred: ApiCredential, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: cred.key,
    Authorization: `Bearer ${cred.key}`,
    ...extra,
  };
}

/** SELECT the declared observation field set for exactly one row. */
export async function postgrestReadRow(
  cred: ApiCredential,
  table: string,
  rowId: string,
  selectFields: readonly string[],
  fetchImpl: FetchLike,
): Promise<{ status: number; rows: unknown[] }> {
  const select = selectFields.map(encodeURIComponent).join(",");
  const url = restUrl(cred, table, `id=eq.${encodeURIComponent(rowId)}&select=${select}`);
  let res: { status: number; bodyText: string };
  try {
    res = await fetchImpl(url, { method: "GET", headers: headers(cred) });
  } catch (err) {
    throw new PostgrestTransportError(
      `read transport failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let rows: unknown[] = [];
  if (res.status >= 200 && res.status < 300) {
    try {
      const parsed: unknown = JSON.parse(res.bodyText);
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      rows = [];
    }
  }
  return { status: res.status, rows };
}

/**
 * Atomic conditional set-to-value:
 *
 *   UPDATE <table> SET field = <target>, revision = <next>
 *   WHERE id = <rowId> AND revision = <expectedPrior>
 *
 * Returns the number of rows the representation carried (0 = predicate did
 * not hold = nothing written; 1 = exactly the target row was written). The
 * row count is INVOCATION EVIDENCE — it classifies the ack, never reality.
 */
export async function postgrestCasWrite(
  cred: ApiCredential,
  table: string,
  rowId: string,
  expectedPriorRevision: number,
  targetValue: string,
  nextRevision: number,
  fetchImpl: FetchLike,
): Promise<{ status: number; rowsReturned: number | null }> {
  const url = restUrl(
    cred,
    table,
    `id=eq.${encodeURIComponent(rowId)}&revision=eq.${expectedPriorRevision}`,
  );
  let res: { status: number; bodyText: string };
  try {
    res = await fetchImpl(url, {
      method: "PATCH",
      headers: headers(cred, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify({ field: targetValue, revision: nextRevision }),
    });
  } catch (err) {
    throw new PostgrestTransportError(
      `write transport failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let rowsReturned: number | null = null;
  if (res.status >= 200 && res.status < 300) {
    try {
      const parsed: unknown = JSON.parse(res.bodyText);
      if (Array.isArray(parsed)) rowsReturned = parsed.length;
    } catch {
      rowsReturned = null;
    }
  }
  return { status: res.status, rowsReturned };
}
