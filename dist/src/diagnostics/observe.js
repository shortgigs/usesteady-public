/**
 * Read-only observation probes (INV-DIAG-IMPL-1, INV-DIAG-IMPL-8).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchIssuerSnapshot, loadCache, resolveEffectiveState, resolveOpsBaseUrl, resolveOrgIdForRefresh, } from "../shell/cli/entitlement-cache.js";
const CONFIG_PATH = join(homedir(), ".usesteady", "config.json");
const CLERK_KEY_ENV_NAMES = [
    "CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "VITE_CLERK_PUBLISHABLE_KEY",
];
const ENV_NEWLINE_WATCH = [
    "USESTEADY_ORG_ID",
    "USESTEADY_ORGANIZATION_ID",
    "USESTEADY_OPS_URL",
    "CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
];
function nowIso() {
    return new Date().toISOString();
}
function configStringValue(cfg, key) {
    const value = cfg[key];
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
export function readUseSteadyConfig() {
    if (!existsSync(CONFIG_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
    catch {
        return null;
    }
}
function hostnameFromUrl(value) {
    try {
        return new URL(value).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
export function probeIdentityObservations(env = process.env) {
    const at = nowIso();
    const out = [];
    for (const name of CLERK_KEY_ENV_NAMES) {
        const raw = env[name];
        if (!raw)
            continue;
        if (raw.includes("pk_test_")) {
            out.push({
                class: "identity",
                code: "clerk_dev_keys_detected",
                severity: "warn",
                message: `${name} appears to be a Clerk development key`,
                observed_at: at,
                evidence: { env_var: name },
            });
            break;
        }
    }
    const orgId = resolveOrgIdForRefresh(env);
    if (!orgId) {
        out.push({
            class: "identity",
            code: "active_org_ambiguous",
            severity: "error",
            message: "No org_id configured (USESTEADY_ORG_ID or ~/.usesteady/config.json)",
            observed_at: at,
        });
    }
    return out;
}
export function probeRuntimeObservations(env = process.env) {
    const at = nowIso();
    const out = [];
    for (const name of ENV_NEWLINE_WATCH) {
        const raw = env[name];
        if (raw === undefined)
            continue;
        if (raw !== raw.trimEnd() || raw.includes("\r") || raw.endsWith("\n")) {
            out.push({
                class: "runtime",
                code: "env_suffix_newline_corruption",
                severity: "warn",
                message: `${name} has trailing whitespace or newline characters`,
                observed_at: at,
                evidence: { env_var: name },
            });
        }
    }
    const expectedMigration = env.USESTEADY_EXPECT_MIGRATION_REVISION?.trim();
    const appliedRevision = env.USESTEADY_APPLIED_MIGRATION_REVISION?.trim();
    if (expectedMigration && expectedMigration !== appliedRevision) {
        out.push({
            class: "runtime",
            code: "migration_missing",
            severity: "error",
            message: `Expected migration revision ${expectedMigration} not applied`,
            observed_at: at,
            evidence: {
                expected: expectedMigration,
                applied: appliedRevision ?? null,
            },
        });
    }
    return out;
}
export function probePortalObservations(env = process.env) {
    const at = nowIso();
    const out = [];
    const cfg = readUseSteadyConfig();
    const portalUrl = env.PORTAL_URL?.trim() ||
        (cfg ? configStringValue(cfg, "portal_url") : null) ||
        (cfg ? configStringValue(cfg, "portal_base_url") : null);
    const orgId = resolveOrgIdForRefresh(env);
    if (orgId && !portalUrl) {
        out.push({
            class: "portal",
            code: "portal_domain_missing",
            severity: "warn",
            message: "Portal URL not configured (PORTAL_URL or config portal_url)",
            observed_at: at,
        });
    }
    const successUrl = env.CHECKOUT_SUCCESS_URL?.trim() ||
        (cfg ? configStringValue(cfg, "checkout_success_url") : null);
    const cancelUrl = env.CHECKOUT_CANCEL_URL?.trim() ||
        (cfg ? configStringValue(cfg, "checkout_cancel_url") : null);
    if (successUrl && cancelUrl) {
        const successHost = hostnameFromUrl(successUrl);
        const cancelHost = hostnameFromUrl(cancelUrl);
        if (successHost && cancelHost && successHost !== cancelHost) {
            out.push({
                class: "portal",
                code: "checkout_redirect_mismatch",
                severity: "error",
                message: "Checkout success and cancel URLs use different hosts",
                observed_at: at,
                evidence: { success_host: successHost, cancel_host: cancelHost },
            });
        }
    }
    if (portalUrl && successUrl) {
        const portalHost = hostnameFromUrl(portalUrl);
        const successHost = hostnameFromUrl(successUrl);
        const opsHost = hostnameFromUrl(resolveOpsBaseUrl(env));
        if (portalHost && successHost && opsHost && successHost === opsHost && portalHost !== opsHost) {
            out.push({
                class: "portal",
                code: "checkout_redirect_mismatch",
                severity: "error",
                message: "Checkout success URL host matches ops API, not portal host",
                observed_at: at,
                evidence: { portal_host: portalHost, success_host: successHost },
            });
        }
    }
    return out;
}
export function probeEntitlementObservationsFromCache(input) {
    const at = nowIso();
    const out = [];
    const now = input.now ?? new Date();
    if (input.effective.branch === "fail_closed") {
        out.push({
            class: "entitlement",
            code: "effective_state_fail_closed",
            severity: "error",
            message: input.effective.detail ?? "Entitlement state is fail-closed",
            observed_at: at,
        });
    }
    const cache = input.cache;
    if (cache) {
        const expiresMs = Date.parse(cache.expires_at);
        if (Number.isFinite(expiresMs) && now.getTime() > expiresMs) {
            out.push({
                class: "entitlement",
                code: "cache_stale",
                severity: "warn",
                message: "Local entitlement cache is past cache TTL (expires_at)",
                observed_at: at,
                evidence: { expires_at: cache.expires_at },
            });
        }
    }
    return out;
}
export function probeBillingObservations(input) {
    const at = nowIso();
    const out = [];
    if (!input.orgId)
        return out;
    if (input.issuerReachable && input.issuerState === "none") {
        out.push({
            class: "billing",
            code: "stripe_customer_missing",
            severity: "error",
            message: "Issuer reports no entitlement state for org (possible missing Stripe customer)",
            observed_at: at,
        });
    }
    if (input.issuerReachable &&
        input.issuerState &&
        input.issuerState !== "none" &&
        process.env.USESTEADY_INVOICE_PROBE === "1") {
        out.push({
            class: "billing",
            code: "invoice_projection_unavailable",
            severity: "warn",
            message: "Invoice projection probe enabled but no invoice API wired in core v1",
            observed_at: at,
        });
    }
    return out;
}
export function collectLocalObservations(env = process.env, cachePath, now) {
    const cache = loadCache(cachePath);
    const effective = resolveEffectiveState({
        issuerReachable: false,
        cache,
        ...(now !== undefined ? { now } : {}),
    });
    const observations = [
        ...probeIdentityObservations(env),
        ...probeRuntimeObservations(env),
        ...probePortalObservations(env),
        ...probeEntitlementObservationsFromCache({ cache, effective, ...(now !== undefined ? { now } : {}) }),
        ...probeBillingObservations({
            orgId: resolveOrgIdForRefresh(env),
            issuerReachable: false,
        }),
    ];
    return { observations, effective, cache };
}
export async function collectIssuerObservations(env = process.env, deps) {
    const at = nowIso();
    const orgId = resolveOrgIdForRefresh(env);
    if (!orgId)
        return [];
    const fetched = await fetchIssuerSnapshot({
        baseUrl: resolveOpsBaseUrl(env),
        orgId,
        ...(deps?.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    if (!fetched.ok) {
        return [{
                class: "entitlement",
                code: "issuer_unreachable",
                severity: "error",
                message: fetched.error,
                observed_at: at,
                ...(fetched.httpStatus !== undefined
                    ? { evidence: { http_status: fetched.httpStatus } }
                    : {}),
            }];
    }
    return probeBillingObservations({
        orgId,
        issuerReachable: true,
        issuerState: fetched.snapshot.state,
    });
}
export async function collectObservations(input) {
    const env = input.env ?? process.env;
    const local = collectLocalObservations(env, input.cachePath, input.now);
    if (!input.probeIssuer) {
        return { observations: local.observations, effective: local.effective };
    }
    const orgId = resolveOrgIdForRefresh(env);
    const at = nowIso();
    let issuerReachable = false;
    let issuerSnapshot = null;
    const issuerEntitlementObs = [];
    if (orgId) {
        const fetched = await fetchIssuerSnapshot({
            baseUrl: resolveOpsBaseUrl(env),
            orgId,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        });
        if (fetched.ok) {
            issuerReachable = true;
            issuerSnapshot = fetched.snapshot;
        }
        else {
            issuerEntitlementObs.push({
                class: "entitlement",
                code: "issuer_unreachable",
                severity: "error",
                message: fetched.error,
                observed_at: at,
                ...(fetched.httpStatus !== undefined
                    ? { evidence: { http_status: fetched.httpStatus } }
                    : {}),
            });
        }
    }
    const effective = resolveEffectiveState({
        issuerReachable,
        issuerSnapshot,
        cache: local.cache,
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    const base = local.observations.filter((o) => o.class !== "entitlement" && o.class !== "billing");
    const entitlementObs = probeEntitlementObservationsFromCache({
        cache: local.cache,
        effective,
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    const billingObs = probeBillingObservations({
        orgId,
        issuerReachable,
        issuerState: issuerSnapshot?.state ?? null,
    });
    return {
        observations: [
            ...base,
            ...entitlementObs,
            ...issuerEntitlementObs,
            ...billingObs,
        ],
        effective,
    };
}
//# sourceMappingURL=observe.js.map