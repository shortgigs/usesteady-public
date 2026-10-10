/**
 * Candidate Plan Bridge (P.S1) - opt-in resolution.
 *
 * DEFAULT OFF. Emission to the Portal is enabled ONLY when the operator
 * explicitly opts in (USESTEADY_PORTAL_CANDIDATE_PLANS=1) AND the destination
 * base URL AND the entitlement bearer token are all present. Any missing piece
 * => disabled with a structured reason (no throw, no partial send) - exactly
 * the Decision Record Bridge posture. Reporting is a side-channel that can
 * never affect a run (INV-PS1-2).
 *
 * The bearer token env is SHARED with the other Core->Portal side-channels
 * (USESTEADY_PORTAL_TOKEN): one org-scoped entitlement token authorizes them all.
 *
 * Env vars (resolved on the machine):
 *   - USESTEADY_PORTAL_CANDIDATE_PLANS     : "1" to opt in (the toggle)
 *   - USESTEADY_PORTAL_CANDIDATE_PLANS_URL : Portal base URL (no ingest path)
 *   - USESTEADY_PORTAL_TOKEN               : entitlement-derived bearer (shared)
 */

import { PORTAL_TOKEN_ENV } from "../execution-return/opt-in.js";

export type CandidatePlanReportingConfig =
  | { readonly enabled: true; readonly url: string; readonly token: string }
  | { readonly enabled: false; readonly reason: CandidatePlanReportingDisabledReason };

export type CandidatePlanReportingDisabledReason =
  | "opt_in_off"
  | "no_url"
  | "no_token"
  | "invalid_url_suffix";

export const CANDIDATE_PLANS_TOGGLE_ENV = "USESTEADY_PORTAL_CANDIDATE_PLANS";
export const CANDIDATE_PLANS_URL_ENV = "USESTEADY_PORTAL_CANDIDATE_PLANS_URL";
export { PORTAL_TOKEN_ENV } from "../execution-return/opt-in.js";

/** Suffix operators must not include (transport appends it -> avoids double path). */
const INGEST_SUFFIX = /\/api\/v1\/candidate-plans\/?$/i;

/**
 * Portal base URL only. Rejects a value that already includes the ingest path
 * (common operator mistake -> double path -> HTTP 404).
 */
export function normalizeCandidatePlansBaseUrl(
  raw: string,
): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: "invalid_url_suffix" } {
  const trimmed = raw.trim();
  if (INGEST_SUFFIX.test(trimmed)) return { ok: false, reason: "invalid_url_suffix" };
  return { ok: true, url: trimmed.replace(/\/+$/, "") };
}

export function resolveCandidatePlanReporting(input: {
  readonly env?: Readonly<Record<string, string | undefined>>;
}): CandidatePlanReportingConfig {
  const env = input.env ?? process.env;

  // Default off: the toggle must be exactly "1".
  if (env[CANDIDATE_PLANS_TOGGLE_ENV]?.trim() !== "1") {
    return { enabled: false, reason: "opt_in_off" };
  }

  const rawUrl = env[CANDIDATE_PLANS_URL_ENV]?.trim();
  if (!rawUrl) return { enabled: false, reason: "no_url" };

  const normalized = normalizeCandidatePlansBaseUrl(rawUrl);
  if (!normalized.ok) return { enabled: false, reason: normalized.reason };

  const token = env[PORTAL_TOKEN_ENV]?.trim();
  if (!token) return { enabled: false, reason: "no_token" };

  return { enabled: true, url: normalized.url, token };
}
