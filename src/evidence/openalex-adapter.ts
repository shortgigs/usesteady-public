/**
 * USESTEADY_OPENALEX_OBSERVER_BOUNDARY_VALIDATION_V1 — read-only OpenAlex adapter.
 *
 * A single, isolated network boundary. It performs read-only GET queries against
 * the OpenAlex `works` endpoint and maps results into SNAPSHOTTED Evidence
 * references. It carries zero authority and imports no Constitution surface.
 *
 * Discipline:
 *   - READ ONLY. No writes to OpenAlex; no mutation of any UseSteady state.
 *   - NO REORDERING. Results are returned in source (API response) order, capped
 *     to a budget. The adapter never sorts by citations, recency, or any score —
 *     ranking-as-importance is an explicit non-goal.
 *   - Credentials come from the environment only (OPENALEX_API_KEY,
 *     OPENALEX_MAILTO). The key is never hardcoded, logged, or returned.
 *   - `fetchFn` is injectable so tests run deterministically on fixtures with no
 *     network.
 */

import type { EvidenceReference, EvidenceSource } from "./types.js";

export const OPENALEX_API_KEY_ENV = "OPENALEX_API_KEY";
export const OPENALEX_MAILTO_ENV = "OPENALEX_MAILTO";
/** Stable source id stamped onto every OpenAlex EvidenceReference. */
export const OPENALEX_SOURCE_ID = "openalex";

const OPENALEX_WORKS_ENDPOINT = "https://api.openalex.org/works";
const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 25; // budget guard ceiling, regardless of caller request

/** Minimal fetch shape so tests can inject a fixture without a DOM/Node lib dep. */
export type OpenAlexFetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export type SearchOptions = {
  /** Budget cap on returned references (clamped to HARD_MAX_RESULTS). */
  readonly maxResults?: number;
  /** Injected fetch (tests). Defaults to global fetch when available. */
  readonly fetchFn?: OpenAlexFetch;
  /** Override API key (defaults to env OPENALEX_API_KEY). */
  readonly apiKey?: string;
  /** Override mailto (defaults to env OPENALEX_MAILTO). */
  readonly mailto?: string;
};

type OpenAlexWork = {
  id?: unknown;
  title?: unknown;
  display_name?: unknown;
  publication_year?: unknown;
  doi?: unknown;
  cited_by_count?: unknown;
};

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function resolveFetch(injected?: OpenAlexFetch): OpenAlexFetch | null {
  if (injected) return injected;
  const g = (globalThis as { fetch?: unknown }).fetch;
  if (typeof g === "function") return g as unknown as OpenAlexFetch;
  return null;
}

function buildUrl(query: string, perPage: number, apiKey: string | null, mailto: string | null): string {
  const params = new URLSearchParams();
  params.set("search", query);
  params.set("per-page", String(perPage));
  // Restrict the payload to the fields we snapshot — read-only, minimal.
  params.set("select", "id,display_name,title,publication_year,doi,cited_by_count");
  if (mailto) params.set("mailto", mailto);
  if (apiKey) params.set("api_key", apiKey);
  return `${OPENALEX_WORKS_ENDPOINT}?${params.toString()}`;
}

function snapshotWork(work: OpenAlexWork, sourceUrl: string, accessedAt: string): EvidenceReference {
  const id = asStringOrNull(work.id) ?? "";
  return {
    source: OPENALEX_SOURCE_ID,
    sourceId: id,
    title: asStringOrNull(work.title) ?? asStringOrNull(work.display_name),
    publicationYear: asNumberOrNull(work.publication_year),
    doi: asStringOrNull(work.doi),
    citedByCount: asNumberOrNull(work.cited_by_count),
    sourceUrl,
    accessedAt,
  };
}

/**
 * Query OpenAlex for works matching `query`. Read-only.
 *
 * Returns references in source order, capped to the budget. Throws on hard
 * failure (no fetch available, non-OK response, malformed payload) — callers in
 * the observer path use `observeEvidence`, which swallows these to stay
 * best-effort.
 */
export async function searchWorks(query: string, opts?: SearchOptions): Promise<readonly EvidenceReference[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const fetchFn = resolveFetch(opts?.fetchFn);
  if (!fetchFn) {
    throw new Error("openalex_no_fetch: no fetch implementation available.");
  }

  const requested = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
  const perPage = Math.max(1, Math.min(requested, HARD_MAX_RESULTS));
  const apiKey = opts?.apiKey ?? process.env[OPENALEX_API_KEY_ENV] ?? null;
  const mailto = opts?.mailto ?? process.env[OPENALEX_MAILTO_ENV] ?? null;

  const url = buildUrl(trimmed, perPage, apiKey, mailto);
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`openalex_http_${res.status}`);
  }

  const body = (await res.json()) as { results?: unknown };
  const results = Array.isArray(body.results) ? (body.results as OpenAlexWork[]) : [];
  const accessedAt = new Date().toISOString();

  // No reordering: preserve API order, cap to budget.
  return results.slice(0, perPage).map((w) => snapshotWork(w, url, accessedAt));
}

/**
 * Build the OpenAlex EvidenceSource — the FIRST implementation of the source seam.
 *
 * Source-specific configuration (API key, mailto, injected fetch, default budget)
 * is bound here; the EvidenceSource contract stays source-agnostic so a future
 * arXiv/Crossref/PubMed source is a new factory, not a schema change. The source
 * carries zero authority: it only discovers references in source order.
 */
export function createOpenAlexSource(config?: SearchOptions): EvidenceSource {
  return {
    id: OPENALEX_SOURCE_ID,
    search: (query, maxResults) =>
      searchWorks(query, maxResults !== undefined ? { ...config, maxResults } : { ...config }),
  };
}
