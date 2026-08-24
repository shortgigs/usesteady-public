/**
 * Sprint F — Core entitlement cache bridge (read-only consumer).
 *
 * Contract: usesteady-ops docs/product/core-entitlement-cache-bridge-contract-v1.md
 * INV-CACHE-1..12 — visibility only; no execution gates.
 */
import { createHash, randomUUID } from "node:crypto";
import { buildWorkflowHealthDiagnosticRecordSync } from "../../diagnostics/build.js";
import { renderEntitlementHealthSummary } from "../../diagnostics/render.js";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const USESTEADY_DIR = join(homedir(), ".usesteady");
const CONFIG_PATH = join(USESTEADY_DIR, "config.json");
/** Bounded offline fallback window (descriptive TTL only). */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OPS_BASE_URL = "https://usesteady-ops.vercel.app";
function configStringValue(cfg, key) {
    const value = cfg[key];
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
export function entitlementCachePath() {
    const override = process.env.USESTEADY_ENTITLEMENT_CACHE_PATH?.trim();
    if (override)
        return override;
    return join(USESTEADY_DIR, "entitlement.json");
}
export function resolveOpsBaseUrl(env = process.env) {
    const fromEnv = env.USESTEADY_OPS_URL?.trim();
    if (fromEnv)
        return fromEnv.replace(/\/$/, "");
    if (existsSync(CONFIG_PATH)) {
        try {
            const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
            const fromCfg = configStringValue(cfg, "ops_base_url") ??
                configStringValue(cfg, "entitlement_ops_url");
            if (fromCfg)
                return fromCfg.replace(/\/$/, "");
        }
        catch {
            /* ignore */
        }
    }
    return DEFAULT_OPS_BASE_URL;
}
export function resolveOrgIdForRefresh(env = process.env) {
    const fromEnv = env.USESTEADY_ORG_ID?.trim() || env.USESTEADY_ORGANIZATION_ID?.trim();
    if (fromEnv)
        return fromEnv;
    if (existsSync(CONFIG_PATH)) {
        try {
            const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
            const orgId = configStringValue(cfg, "org_id") ??
                configStringValue(cfg, "active_org_id") ??
                configStringValue(cfg, "organization_id");
            if (orgId)
                return orgId;
        }
        catch {
            /* ignore */
        }
    }
    return null;
}
export function canonicalIssuerSnapshotJson(snapshot) {
    const normalized = {
        assigned_count: snapshot.assigned_count,
        expires_at: snapshot.expires_at,
        org_id: snapshot.org_id ?? snapshot.organization_id ?? null,
        seat_count: snapshot.seat_count,
        state: snapshot.state,
    };
    return JSON.stringify(normalized);
}
export function computeIssuerSnapshotHash(snapshot) {
    return createHash("sha256").update(canonicalIssuerSnapshotJson(snapshot)).digest("hex");
}
function parseEntitlementState(value) {
    const allowed = [
        "none", "trialing", "active", "past_due", "canceled", "expired", "blocked",
    ];
    return typeof value === "string" && allowed.includes(value)
        ? value
        : null;
}
export function parseIssuerSnapshot(body) {
    if (!body || typeof body !== "object")
        return null;
    const row = body;
    const state = parseEntitlementState(row.state);
    if (!state)
        return null;
    if (typeof row.seat_count !== "number" || !Number.isFinite(row.seat_count))
        return null;
    if (typeof row.assigned_count !== "number" || !Number.isFinite(row.assigned_count))
        return null;
    const expiresAt = row.expires_at === null || typeof row.expires_at === "string"
        ? row.expires_at
        : null;
    const orgId = typeof row.org_id === "string" ? row.org_id : undefined;
    const organizationId = typeof row.organization_id === "string" ? row.organization_id : undefined;
    return {
        state,
        seat_count: row.seat_count,
        assigned_count: row.assigned_count,
        expires_at: expiresAt,
        ...(orgId ? { org_id: orgId } : {}),
        ...(organizationId ? { organization_id: organizationId } : {}),
    };
}
function effectiveStateFromSnapshot(branch, snapshot, detail) {
    return {
        branch,
        state: snapshot.state,
        seat_count: snapshot.seat_count,
        assigned_count: snapshot.assigned_count,
        entitlement_expires_at: snapshot.expires_at,
        ...(detail ? { detail } : {}),
    };
}
/**
 * Contract-locked resolution (INV-CACHE-9, INV-CACHE-11).
 */
export function resolveEffectiveState(input) {
    const now = input.now ?? new Date();
    if (input.issuerReachable && input.issuerSnapshot) {
        return effectiveStateFromSnapshot("issuer_state", input.issuerSnapshot);
    }
    const cache = input.cache;
    if (cache?.issuer_snapshot) {
        const cacheExpires = Date.parse(cache.expires_at);
        if (Number.isFinite(cacheExpires) && now.getTime() <= cacheExpires) {
            return effectiveStateFromSnapshot("cache_state", cache.issuer_snapshot, "issuer unreachable — bounded cache fallback (visibility only)");
        }
    }
    return {
        branch: "fail_closed",
        state: "none",
        seat_count: 0,
        assigned_count: 0,
        entitlement_expires_at: null,
        detail: "uncertain entitlement — refresh required",
    };
}
export function validateLineage(record) {
    if (!Array.isArray(record.lineage))
        return false;
    return record.lineage.every((entry) => {
        if (!entry || typeof entry !== "object")
            return false;
        const row = entry;
        if (typeof row.at !== "string" || row.at.length === 0)
            return false;
        if (row.kind !== "refresh" && row.kind !== "refresh_attempt" && row.kind !== "retry") {
            return false;
        }
        if (row.outcome !== "success" && row.outcome !== "failed")
            return false;
        return true;
    });
}
export function appendLineageEntry(lineage, entry, maxEntries = 32) {
    return [...lineage, entry].slice(-maxEntries);
}
function isValidIsoTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}
export function parseEntitlementCacheRecord(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const row = raw;
    if (typeof row.refresh_id !== "string" || row.refresh_id.length === 0)
        return null;
    if (!isValidIsoTimestamp(row.refreshed_at))
        return null;
    if (!isValidIsoTimestamp(row.expires_at))
        return null;
    if (typeof row.issuer_snapshot_hash !== "string" || row.issuer_snapshot_hash.length === 0) {
        return null;
    }
    const issuerSnapshot = parseIssuerSnapshot(row.issuer_snapshot);
    if (!issuerSnapshot)
        return null;
    const expectedHash = computeIssuerSnapshotHash(issuerSnapshot);
    if (row.issuer_snapshot_hash !== expectedHash)
        return null;
    const effective = row.effective_state;
    if (!effective || typeof effective !== "object")
        return null;
    const eff = effective;
    const branch = eff.branch;
    if (branch !== "issuer_state" && branch !== "cache_state" && branch !== "fail_closed") {
        return null;
    }
    const effState = parseEntitlementState(eff.state);
    if (!effState)
        return null;
    const lineageRaw = Array.isArray(row.lineage) ? row.lineage : [];
    const lineage = [];
    for (const item of lineageRaw) {
        if (!item || typeof item !== "object")
            return null;
        const e = item;
        if (!isValidIsoTimestamp(e.at))
            return null;
        if (e.kind !== "refresh" && e.kind !== "refresh_attempt" && e.kind !== "retry")
            return null;
        if (e.outcome !== "success" && e.outcome !== "failed")
            return null;
        lineage.push(e);
    }
    const record = {
        refresh_id: row.refresh_id,
        refreshed_at: row.refreshed_at,
        expires_at: row.expires_at,
        issuer_snapshot_hash: row.issuer_snapshot_hash,
        issuer_snapshot: issuerSnapshot,
        effective_state: {
            branch: branch,
            state: effState,
            seat_count: typeof eff.seat_count === "number" ? eff.seat_count : 0,
            assigned_count: typeof eff.assigned_count === "number" ? eff.assigned_count : 0,
            entitlement_expires_at: eff.entitlement_expires_at === null || typeof eff.entitlement_expires_at === "string"
                ? eff.entitlement_expires_at
                : null,
            ...(typeof eff.detail === "string" ? { detail: eff.detail } : {}),
        },
        lineage,
    };
    if (!validateLineage(record))
        return null;
    return record;
}
export function loadCache(cachePath = entitlementCachePath()) {
    if (!existsSync(cachePath))
        return null;
    try {
        const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
        return parseEntitlementCacheRecord(raw);
    }
    catch {
        return null;
    }
}
export function writeCacheAtomically(record, cachePath = entitlementCachePath()) {
    const dir = dirname(cachePath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const tmpPath = `${cachePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, cachePath);
}
export function deleteCache(cachePath = entitlementCachePath()) {
    if (!existsSync(cachePath))
        return false;
    rmSync(cachePath, { force: true });
    return true;
}
export function buildCacheRecordFromIssuer(input) {
    const now = input.now ?? new Date();
    const ttlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const issuerSnapshot = input.issuerSnapshot;
    const issuer_snapshot_hash = computeIssuerSnapshotHash(issuerSnapshot);
    const effective_state = resolveEffectiveState({
        issuerReachable: true,
        issuerSnapshot,
        now,
    });
    const lineage = appendLineageEntry(input.lineagePrefix ?? input.previous?.lineage ?? [], { at: now.toISOString(), kind: "refresh", outcome: "success" });
    return {
        refresh_id: input.refreshId ?? randomUUID(),
        refreshed_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlMs).toISOString(),
        issuer_snapshot_hash,
        issuer_snapshot: issuerSnapshot,
        effective_state,
        lineage,
    };
}
/** INV-CACHE-12: identical issuer truth → identical effective state fields. */
export function effectiveStatesConverge(a, b) {
    return (a.branch === b.branch &&
        a.state === b.state &&
        a.seat_count === b.seat_count &&
        a.assigned_count === b.assigned_count &&
        a.entitlement_expires_at === b.entitlement_expires_at);
}
export async function fetchIssuerSnapshot(input) {
    const fetchFn = input.fetchImpl ?? globalThis.fetch;
    if (!fetchFn) {
        return { ok: false, error: "fetch unavailable in this runtime" };
    }
    const url = new URL(`${input.baseUrl.replace(/\/$/, "")}/api/v1/entitlement/current`);
    if (input.orgId)
        url.searchParams.set("org_id", input.orgId);
    if (input.organizationId)
        url.searchParams.set("organization_id", input.organizationId);
    let response;
    try {
        response = await fetchFn(url.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
    }
    if (!response.ok) {
        return {
            ok: false,
            error: `issuer read failed: HTTP ${response.status}`,
            httpStatus: response.status,
        };
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        return { ok: false, error: "issuer read returned non-JSON body", httpStatus: response.status };
    }
    const snapshot = parseIssuerSnapshot(body);
    if (!snapshot) {
        return { ok: false, error: "issuer response failed validation", httpStatus: response.status };
    }
    return { ok: true, snapshot, httpStatus: response.status };
}
export function parseAuthArgs(argv) {
    if (argv.length === 0)
        return "usage-error";
    const positional = argv.filter((tok) => !tok.startsWith("-"));
    if (positional.length !== 1)
        return "usage-error";
    if (positional[0] === "refresh")
        return { mode: "refresh" };
    if (positional[0] === "status")
        return { mode: "status" };
    if (positional[0] === "logout")
        return { mode: "logout" };
    return "usage-error";
}
export function renderAuthHelpText() {
    return ("\n  Team entitlement cache (read-only visibility)\n\n" +
        "  usesteady auth refresh    Fetch Issuer truth and update ~/.usesteady/entitlement.json\n" +
        "  usesteady auth status     Show effective state from local cache (no network)\n" +
        "  usesteady auth logout     Remove local cache only (does not revoke entitlement)\n\n" +
        "  Configure org: USESTEADY_ORG_ID or ~/.usesteady/config.json (org_id)\n" +
        "  Configure ops: USESTEADY_OPS_URL or config.json (ops_base_url)\n\n");
}
export function renderAuthStatusText(cache, resolved) {
    if (!cache) {
        return ("\n  Team entitlement: no local cache\n" +
            "  Run: usesteady auth refresh\n\n");
    }
    return (`\n  Team entitlement (visibility only)\n` +
        `  refresh_id:    ${cache.refresh_id}\n` +
        `  refreshed_at:  ${cache.refreshed_at}\n` +
        `  cache_expires:   ${cache.expires_at}\n` +
        `  resolution:      ${resolved.branch}\n` +
        `  state:           ${resolved.state}\n` +
        `  seats:           ${resolved.assigned_count} / ${resolved.seat_count}\n` +
        (resolved.entitlement_expires_at
            ? `  entitlement_expires_at: ${resolved.entitlement_expires_at}\n`
            : "") +
        (resolved.detail ? `  note: ${resolved.detail}\n` : "") +
        "\n");
}
export async function runAuthRefresh(env = process.env, deps) {
    const orgId = resolveOrgIdForRefresh(env);
    if (!orgId) {
        return {
            exitCode: 2,
            stdout: "",
            stderr: "\n  Error: org id required for auth refresh\n" +
                "  Set USESTEADY_ORG_ID or org_id in ~/.usesteady/config.json\n\n",
        };
    }
    const baseUrl = resolveOpsBaseUrl(env);
    const cachePath = deps?.cachePath ?? entitlementCachePath();
    const previous = loadCache(cachePath);
    const fetched = await fetchIssuerSnapshot({
        baseUrl,
        orgId,
        ...(deps?.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    if (!fetched.ok) {
        const lineage = appendLineageEntry(previous?.lineage ?? [], {
            at: new Date().toISOString(),
            kind: "refresh_attempt",
            outcome: "failed",
            ...(fetched.httpStatus !== undefined ? { http_status: fetched.httpStatus } : {}),
            note: fetched.error,
        });
        if (previous) {
            // Preserve cache on failed refresh; lineage metadata only in memory for this attempt
            void lineage;
        }
        return {
            exitCode: 1,
            stdout: "",
            stderr: `\n  Error: ${fetched.error}\n  Local cache unchanged.\n\n`,
        };
    }
    const snapshot = {
        ...fetched.snapshot,
        org_id: orgId,
    };
    const record = buildCacheRecordFromIssuer({
        issuerSnapshot: snapshot,
        previous,
        ...(previous ? { lineagePrefix: previous.lineage } : {}),
    });
    writeCacheAtomically(record, cachePath);
    return {
        exitCode: 0,
        stdout: "\n  Entitlement cache updated.\n" +
            `  refresh_id: ${record.refresh_id}\n` +
            `  state: ${record.effective_state.state}\n` +
            `  seats: ${record.effective_state.assigned_count} / ${record.effective_state.seat_count}\n\n`,
        stderr: "",
    };
}
export function runAuthStatus(cachePath = entitlementCachePath(), now, env = process.env) {
    const cache = loadCache(cachePath);
    const resolved = resolveEffectiveState({
        issuerReachable: false,
        cache,
        ...(now !== undefined ? { now } : {}),
    });
    const healthRecord = buildWorkflowHealthDiagnosticRecordSync({
        env,
        cachePath,
        ...(now !== undefined ? { now } : {}),
        run_at: new Date().toISOString(),
    });
    return {
        exitCode: 0,
        stdout: renderAuthStatusText(cache, resolved) +
            renderEntitlementHealthSummary(healthRecord),
        stderr: "",
    };
}
export function runAuthLogout(cachePath = entitlementCachePath()) {
    const removed = deleteCache(cachePath);
    return {
        exitCode: 0,
        stdout: removed
            ? "\n  Local entitlement cache removed (Issuer unchanged).\n\n"
            : "\n  No entitlement cache file present.\n\n",
        stderr: "",
    };
}
export async function runAuthCommand(args, env = process.env, deps) {
    switch (args.mode) {
        case "refresh":
            return runAuthRefresh(env, deps);
        case "status":
            return runAuthStatus(deps?.cachePath);
        case "logout":
            return runAuthLogout(deps?.cachePath);
        default:
            return { exitCode: 0, stdout: renderAuthHelpText(), stderr: "" };
    }
}
//# sourceMappingURL=entitlement-cache.js.map