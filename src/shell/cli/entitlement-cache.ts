/**
 * Sprint F — Core entitlement cache bridge (read-only consumer).
 *
 * Contract: usesteady-ops docs/product/core-entitlement-cache-bridge-contract-v1.md
 * INV-CACHE-1..12 — visibility only; no execution gates.
 */

import { createHash, randomUUID } from "node:crypto";
import { buildWorkflowHealthDiagnosticRecordSync } from "../../diagnostics/build.js";
import { renderEntitlementHealthSummary } from "../../diagnostics/render.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Issuer projection shape from GET /api/v1/entitlement/current */
export type EntitlementState =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "blocked";

export type IssuerSnapshot = {
  readonly state: EntitlementState;
  readonly seat_count: number;
  readonly assigned_count: number;
  readonly expires_at: string | null;
  readonly org_id?: string;
  readonly organization_id?: string;
};

export type EffectiveStateBranch = "issuer_state" | "cache_state" | "fail_closed";

export type EffectiveState = {
  readonly branch: EffectiveStateBranch;
  readonly state: EntitlementState;
  readonly seat_count: number;
  readonly assigned_count: number;
  readonly entitlement_expires_at: string | null;
  readonly detail?: string;
};

export type LineageEntry = {
  readonly at: string;
  readonly kind: "refresh" | "refresh_attempt" | "retry";
  readonly outcome: "success" | "failed";
  readonly http_status?: number;
  readonly note?: string;
};

export type EntitlementCacheRecord = {
  readonly refresh_id: string;
  readonly refreshed_at: string;
  /** Cache TTL cutoff for bounded offline fallback (INV-CACHE-11) — not entitlement validity */
  readonly expires_at: string;
  readonly issuer_snapshot_hash: string;
  readonly issuer_snapshot: IssuerSnapshot;
  readonly effective_state: EffectiveState;
  readonly lineage: readonly LineageEntry[];
};

const USESTEADY_DIR = join(homedir(), ".usesteady");
const CONFIG_PATH = join(USESTEADY_DIR, "config.json");

/** Bounded offline fallback window (descriptive TTL only). */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_OPS_BASE_URL = "https://usesteady-ops.vercel.app";

function configStringValue(cfg: Record<string, unknown>, key: string): string | null {
  const value = cfg[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function entitlementCachePath(): string {
  const override = process.env.USESTEADY_ENTITLEMENT_CACHE_PATH?.trim();
  if (override) return override;
  return join(USESTEADY_DIR, "entitlement.json");
}

export function resolveOpsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.USESTEADY_OPS_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
      const fromCfg =
        configStringValue(cfg, "ops_base_url") ??
        configStringValue(cfg, "entitlement_ops_url");
      if (fromCfg) return fromCfg.replace(/\/$/, "");
    } catch {
      /* ignore */
    }
  }

  return DEFAULT_OPS_BASE_URL;
}

export function resolveOrgIdForRefresh(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.USESTEADY_ORG_ID?.trim() || env.USESTEADY_ORGANIZATION_ID?.trim();
  if (fromEnv) return fromEnv;

  if (existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
      const orgId =
        configStringValue(cfg, "org_id") ??
        configStringValue(cfg, "active_org_id") ??
        configStringValue(cfg, "organization_id");
      if (orgId) return orgId;
    } catch {
      /* ignore */
    }
  }

  return null;
}

export function canonicalIssuerSnapshotJson(snapshot: IssuerSnapshot): string {
  const normalized = {
    assigned_count: snapshot.assigned_count,
    expires_at:     snapshot.expires_at,
    org_id:         snapshot.org_id ?? snapshot.organization_id ?? null,
    seat_count:     snapshot.seat_count,
    state:          snapshot.state,
  };
  return JSON.stringify(normalized);
}

export function computeIssuerSnapshotHash(snapshot: IssuerSnapshot): string {
  return createHash("sha256").update(canonicalIssuerSnapshotJson(snapshot)).digest("hex");
}

function parseEntitlementState(value: unknown): EntitlementState | null {
  const allowed: readonly EntitlementState[] = [
    "none", "trialing", "active", "past_due", "canceled", "expired", "blocked",
  ];
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as EntitlementState)
    : null;
}

export function parseIssuerSnapshot(body: unknown): IssuerSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const state = parseEntitlementState(row.state);
  if (!state) return null;
  if (typeof row.seat_count !== "number" || !Number.isFinite(row.seat_count)) return null;
  if (typeof row.assigned_count !== "number" || !Number.isFinite(row.assigned_count)) return null;
  const expiresAt =
    row.expires_at === null || typeof row.expires_at === "string"
      ? (row.expires_at as string | null)
      : null;

  const orgId = typeof row.org_id === "string" ? row.org_id : undefined;
  const organizationId = typeof row.organization_id === "string" ? row.organization_id : undefined;

  return {
    state,
    seat_count:     row.seat_count,
    assigned_count: row.assigned_count,
    expires_at:     expiresAt,
    ...(orgId ? { org_id: orgId } : {}),
    ...(organizationId ? { organization_id: organizationId } : {}),
  };
}

function effectiveStateFromSnapshot(
  branch: EffectiveStateBranch,
  snapshot: IssuerSnapshot,
  detail?: string,
): EffectiveState {
  return {
    branch,
    state:                    snapshot.state,
    seat_count:               snapshot.seat_count,
    assigned_count:           snapshot.assigned_count,
    entitlement_expires_at:   snapshot.expires_at,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Contract-locked resolution (INV-CACHE-9, INV-CACHE-11).
 */
export function resolveEffectiveState(input: {
  issuerReachable: boolean;
  issuerSnapshot?: IssuerSnapshot | null;
  cache?: EntitlementCacheRecord | null;
  now?: Date;
}): EffectiveState {
  const now = input.now ?? new Date();

  if (input.issuerReachable && input.issuerSnapshot) {
    return effectiveStateFromSnapshot("issuer_state", input.issuerSnapshot);
  }

  const cache = input.cache;
  if (cache?.issuer_snapshot) {
    const cacheExpires = Date.parse(cache.expires_at);
    if (Number.isFinite(cacheExpires) && now.getTime() <= cacheExpires) {
      return effectiveStateFromSnapshot(
        "cache_state",
        cache.issuer_snapshot,
        "issuer unreachable — bounded cache fallback (visibility only)",
      );
    }
  }

  return {
    branch:                  "fail_closed",
    state:                   "none",
    seat_count:              0,
    assigned_count:          0,
    entitlement_expires_at:  null,
    detail:                  "uncertain entitlement — refresh required",
  };
}

export function validateLineage(record: EntitlementCacheRecord): boolean {
  if (!Array.isArray(record.lineage)) return false;
  return record.lineage.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as LineageEntry;
    if (typeof row.at !== "string" || row.at.length === 0) return false;
    if (row.kind !== "refresh" && row.kind !== "refresh_attempt" && row.kind !== "retry") {
      return false;
    }
    if (row.outcome !== "success" && row.outcome !== "failed") return false;
    return true;
  });
}

export function appendLineageEntry(
  lineage: readonly LineageEntry[],
  entry: LineageEntry,
  maxEntries = 32,
): LineageEntry[] {
  return [...lineage, entry].slice(-maxEntries);
}

function isValidIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseEntitlementCacheRecord(raw: unknown): EntitlementCacheRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.refresh_id !== "string" || row.refresh_id.length === 0) return null;
  if (!isValidIsoTimestamp(row.refreshed_at)) return null;
  if (!isValidIsoTimestamp(row.expires_at)) return null;
  if (typeof row.issuer_snapshot_hash !== "string" || row.issuer_snapshot_hash.length === 0) {
    return null;
  }

  const issuerSnapshot = parseIssuerSnapshot(row.issuer_snapshot);
  if (!issuerSnapshot) return null;

  const expectedHash = computeIssuerSnapshotHash(issuerSnapshot);
  if (row.issuer_snapshot_hash !== expectedHash) return null;

  const effective = row.effective_state;
  if (!effective || typeof effective !== "object") return null;
  const eff = effective as Record<string, unknown>;
  const branch = eff.branch;
  if (branch !== "issuer_state" && branch !== "cache_state" && branch !== "fail_closed") {
    return null;
  }
  const effState = parseEntitlementState(eff.state);
  if (!effState) return null;

  const lineageRaw = Array.isArray(row.lineage) ? row.lineage : [];
  const lineage: LineageEntry[] = [];
  for (const item of lineageRaw) {
    if (!item || typeof item !== "object") return null;
    const e = item as LineageEntry;
    if (!isValidIsoTimestamp(e.at)) return null;
    if (e.kind !== "refresh" && e.kind !== "refresh_attempt" && e.kind !== "retry") return null;
    if (e.outcome !== "success" && e.outcome !== "failed") return null;
    lineage.push(e);
  }

  const record: EntitlementCacheRecord = {
    refresh_id:             row.refresh_id as string,
    refreshed_at:           row.refreshed_at as string,
    expires_at:             row.expires_at as string,
    issuer_snapshot_hash:   row.issuer_snapshot_hash,
    issuer_snapshot:        issuerSnapshot,
    effective_state: {
      branch:                 branch as EffectiveStateBranch,
      state:                  effState,
      seat_count:             typeof eff.seat_count === "number" ? eff.seat_count : 0,
      assigned_count:         typeof eff.assigned_count === "number" ? eff.assigned_count : 0,
      entitlement_expires_at:
        eff.entitlement_expires_at === null || typeof eff.entitlement_expires_at === "string"
          ? (eff.entitlement_expires_at as string | null)
          : null,
      ...(typeof eff.detail === "string" ? { detail: eff.detail } : {}),
    },
    lineage,
  };

  if (!validateLineage(record)) return null;
  return record;
}

export function loadCache(cachePath: string = entitlementCachePath()): EntitlementCacheRecord | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8")) as unknown;
    return parseEntitlementCacheRecord(raw);
  } catch {
    return null;
  }
}

export function writeCacheAtomically(
  record: EntitlementCacheRecord,
  cachePath: string = entitlementCachePath(),
): void {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${cachePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, cachePath);
}

export function deleteCache(cachePath: string = entitlementCachePath()): boolean {
  if (!existsSync(cachePath)) return false;
  rmSync(cachePath, { force: true });
  return true;
}

export function buildCacheRecordFromIssuer(input: {
  issuerSnapshot: IssuerSnapshot;
  previous?: EntitlementCacheRecord | null;
  now?: Date;
  cacheTtlMs?: number;
  refreshId?: string;
  lineagePrefix?: readonly LineageEntry[];
}): EntitlementCacheRecord {
  const now = input.now ?? new Date();
  const ttlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const issuerSnapshot = input.issuerSnapshot;
  const issuer_snapshot_hash = computeIssuerSnapshotHash(issuerSnapshot);
  const effective_state = resolveEffectiveState({
    issuerReachable: true,
    issuerSnapshot,
    now,
  });

  const lineage = appendLineageEntry(
    input.lineagePrefix ?? input.previous?.lineage ?? [],
    { at: now.toISOString(), kind: "refresh", outcome: "success" },
  );

  return {
    refresh_id:           input.refreshId ?? randomUUID(),
    refreshed_at:         now.toISOString(),
    expires_at:           new Date(now.getTime() + ttlMs).toISOString(),
    issuer_snapshot_hash,
    issuer_snapshot:      issuerSnapshot,
    effective_state,
    lineage,
  };
}

/** INV-CACHE-12: identical issuer truth → identical effective state fields. */
export function effectiveStatesConverge(
  a: EffectiveState,
  b: EffectiveState,
): boolean {
  return (
    a.branch === b.branch &&
    a.state === b.state &&
    a.seat_count === b.seat_count &&
    a.assigned_count === b.assigned_count &&
    a.entitlement_expires_at === b.entitlement_expires_at
  );
}

export async function fetchIssuerSnapshot(input: {
  baseUrl: string;
  orgId?: string | null;
  organizationId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; snapshot: IssuerSnapshot; httpStatus: number }
  | { ok: false; error: string; httpStatus?: number }
> {
  const fetchFn = input.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    return { ok: false, error: "fetch unavailable in this runtime" };
  }

  const url = new URL(`${input.baseUrl.replace(/\/$/, "")}/api/v1/entitlement/current`);
  if (input.orgId) url.searchParams.set("org_id", input.orgId);
  if (input.organizationId) url.searchParams.set("organization_id", input.organizationId);

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method:  "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  if (!response.ok) {
    return {
      ok:          false,
      error:       `issuer read failed: HTTP ${response.status}`,
      httpStatus:  response.status,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "issuer read returned non-JSON body", httpStatus: response.status };
  }

  const snapshot = parseIssuerSnapshot(body);
  if (!snapshot) {
    return { ok: false, error: "issuer response failed validation", httpStatus: response.status };
  }

  return { ok: true, snapshot, httpStatus: response.status };
}

export type AuthCommandArgs =
  | { readonly mode: "help" }
  | { readonly mode: "refresh" }
  | { readonly mode: "status" }
  | { readonly mode: "logout" };

export function parseAuthArgs(argv: readonly string[]): AuthCommandArgs | "usage-error" {
  if (argv.length === 0) return "usage-error";
  const positional = argv.filter((tok) => !tok.startsWith("-"));
  if (positional.length !== 1) return "usage-error";
  if (positional[0] === "refresh") return { mode: "refresh" };
  if (positional[0] === "status") return { mode: "status" };
  if (positional[0] === "logout") return { mode: "logout" };
  return "usage-error";
}

export function renderAuthHelpText(): string {
  return (
    "\n  Team entitlement cache (read-only visibility)\n\n" +
    "  usesteady auth refresh    Fetch Issuer truth and update ~/.usesteady/entitlement.json\n" +
    "  usesteady auth status     Show effective state from local cache (no network)\n" +
    "  usesteady auth logout     Remove local cache only (does not revoke entitlement)\n\n" +
    "  Configure org: USESTEADY_ORG_ID or ~/.usesteady/config.json (org_id)\n" +
    "  Configure ops: USESTEADY_OPS_URL or config.json (ops_base_url)\n\n"
  );
}

export function renderAuthStatusText(
  cache: EntitlementCacheRecord | null,
  resolved: EffectiveState,
): string {
  if (!cache) {
    return (
      "\n  Team entitlement: no local cache\n" +
      "  Run: usesteady auth refresh\n\n"
    );
  }

  return (
    `\n  Team entitlement (visibility only)\n` +
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
    "\n"
  );
}

export type AuthCommandResult = {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
};

export async function runAuthRefresh(
  env: NodeJS.ProcessEnv = process.env,
  deps?: {
    cachePath?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<AuthCommandResult> {
  const orgId = resolveOrgIdForRefresh(env);
  if (!orgId) {
    return {
      exitCode: 2,
      stdout:   "",
      stderr:
        "\n  Error: org id required for auth refresh\n" +
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
      at:      new Date().toISOString(),
      kind:    "refresh_attempt",
      outcome: "failed",
      ...(fetched.httpStatus !== undefined ? { http_status: fetched.httpStatus } : {}),
      note:    fetched.error,
    });
    if (previous) {
      // Preserve cache on failed refresh; lineage metadata only in memory for this attempt
      void lineage;
    }
    return {
      exitCode: 1,
      stdout:   "",
      stderr:   `\n  Error: ${fetched.error}\n  Local cache unchanged.\n\n`,
    };
  }

  const snapshot: IssuerSnapshot = {
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
    stdout:
      "\n  Entitlement cache updated.\n" +
      `  refresh_id: ${record.refresh_id}\n` +
      `  state: ${record.effective_state.state}\n` +
      `  seats: ${record.effective_state.assigned_count} / ${record.effective_state.seat_count}\n\n`,
    stderr: "",
  };
}

export function runAuthStatus(
  cachePath: string = entitlementCachePath(),
  now?: Date,
  env: NodeJS.ProcessEnv = process.env,
): AuthCommandResult {
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
    stdout:
      renderAuthStatusText(cache, resolved) +
      renderEntitlementHealthSummary(healthRecord),
    stderr:   "",
  };
}

export function runAuthLogout(
  cachePath: string = entitlementCachePath(),
): AuthCommandResult {
  const removed = deleteCache(cachePath);
  return {
    exitCode: 0,
    stdout:   removed
      ? "\n  Local entitlement cache removed (Issuer unchanged).\n\n"
      : "\n  No entitlement cache file present.\n\n",
    stderr:   "",
  };
}

export async function runAuthCommand(
  args: AuthCommandArgs,
  env: NodeJS.ProcessEnv = process.env,
  deps?: {
    cachePath?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<AuthCommandResult> {
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
