/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - opt-in resolution.
 *
 * INV-ERB-P1: DEFAULT OFF. Reporting is enabled ONLY when the buyer explicitly
 * opts in (per-run `--report-to-portal` flag) AND the destination URL AND the
 * entitlement bearer token are both present. Any missing piece => disabled, with
 * a structured reason (no throw, no partial send).
 *
 * Env vars (resolved on the machine):
 *   - USESTEADY_PORTAL_RUNS_URL : Portal base URL (e.g. https://app.usesteady.dev)
 *   - USESTEADY_PORTAL_TOKEN    : entitlement-derived bearer token
 */
/** Suffix operators must not include in USESTEADY_PORTAL_RUNS_URL (transport appends it). */
const RUNS_API_SUFFIX = /\/api\/v1\/runs\/?$/i;
/**
 * Portal base URL only. Rejects values that already include the ingest path
 * (common operator mistake → double path → HTTP 404).
 */
export function normalizePortalRunsBaseUrl(raw) {
    const trimmed = raw.trim();
    if (RUNS_API_SUFFIX.test(trimmed)) {
        return { ok: false, reason: "invalid_runs_url_suffix" };
    }
    return { ok: true, url: trimmed.replace(/\/+$/, "") };
}
export const PORTAL_RUNS_URL_ENV = "USESTEADY_PORTAL_RUNS_URL";
export const PORTAL_TOKEN_ENV = "USESTEADY_PORTAL_TOKEN";
export function resolvePortalReporting(input) {
    // Default off (INV-ERB-P1): no flag => never send, regardless of env.
    if (!input.flag)
        return { enabled: false, reason: "opt_in_off" };
    const env = input.env ?? process.env;
    const rawUrl = env[PORTAL_RUNS_URL_ENV]?.trim();
    if (!rawUrl)
        return { enabled: false, reason: "no_url" };
    const normalized = normalizePortalRunsBaseUrl(rawUrl);
    if (!normalized.ok)
        return { enabled: false, reason: normalized.reason };
    const token = env[PORTAL_TOKEN_ENV]?.trim();
    if (!token)
        return { enabled: false, reason: "no_token" };
    return { enabled: true, url: normalized.url, token };
}
//# sourceMappingURL=opt-in.js.map