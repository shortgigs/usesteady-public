/**
 * Sprint F — Core entitlement cache bridge (read-only consumer).
 *
 * Contract: usesteady-ops docs/product/core-entitlement-cache-bridge-contract-v1.md
 * INV-CACHE-1..12 — visibility only; no execution gates.
 */
/** Issuer projection shape from GET /api/v1/entitlement/current */
export type EntitlementState = "none" | "trialing" | "active" | "past_due" | "canceled" | "expired" | "blocked";
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
/** Bounded offline fallback window (descriptive TTL only). */
export declare const DEFAULT_CACHE_TTL_MS: number;
export declare function entitlementCachePath(): string;
export declare function resolveOpsBaseUrl(env?: NodeJS.ProcessEnv): string;
export declare function resolveOrgIdForRefresh(env?: NodeJS.ProcessEnv): string | null;
export declare function canonicalIssuerSnapshotJson(snapshot: IssuerSnapshot): string;
export declare function computeIssuerSnapshotHash(snapshot: IssuerSnapshot): string;
export declare function parseIssuerSnapshot(body: unknown): IssuerSnapshot | null;
/**
 * Contract-locked resolution (INV-CACHE-9, INV-CACHE-11).
 */
export declare function resolveEffectiveState(input: {
    issuerReachable: boolean;
    issuerSnapshot?: IssuerSnapshot | null;
    cache?: EntitlementCacheRecord | null;
    now?: Date;
}): EffectiveState;
export declare function validateLineage(record: EntitlementCacheRecord): boolean;
export declare function appendLineageEntry(lineage: readonly LineageEntry[], entry: LineageEntry, maxEntries?: number): LineageEntry[];
export declare function parseEntitlementCacheRecord(raw: unknown): EntitlementCacheRecord | null;
export declare function loadCache(cachePath?: string): EntitlementCacheRecord | null;
export declare function writeCacheAtomically(record: EntitlementCacheRecord, cachePath?: string): void;
export declare function deleteCache(cachePath?: string): boolean;
export declare function buildCacheRecordFromIssuer(input: {
    issuerSnapshot: IssuerSnapshot;
    previous?: EntitlementCacheRecord | null;
    now?: Date;
    cacheTtlMs?: number;
    refreshId?: string;
    lineagePrefix?: readonly LineageEntry[];
}): EntitlementCacheRecord;
/** INV-CACHE-12: identical issuer truth → identical effective state fields. */
export declare function effectiveStatesConverge(a: EffectiveState, b: EffectiveState): boolean;
export declare function fetchIssuerSnapshot(input: {
    baseUrl: string;
    orgId?: string | null;
    organizationId?: string | null;
    fetchImpl?: typeof fetch;
}): Promise<{
    ok: true;
    snapshot: IssuerSnapshot;
    httpStatus: number;
} | {
    ok: false;
    error: string;
    httpStatus?: number;
}>;
export type AuthCommandArgs = {
    readonly mode: "help";
} | {
    readonly mode: "refresh";
} | {
    readonly mode: "status";
} | {
    readonly mode: "logout";
};
export declare function parseAuthArgs(argv: readonly string[]): AuthCommandArgs | "usage-error";
export declare function renderAuthHelpText(): string;
export declare function renderAuthStatusText(cache: EntitlementCacheRecord | null, resolved: EffectiveState): string;
export type AuthCommandResult = {
    readonly exitCode: 0 | 1 | 2;
    readonly stdout: string;
    readonly stderr: string;
};
export declare function runAuthRefresh(env?: NodeJS.ProcessEnv, deps?: {
    cachePath?: string;
    fetchImpl?: typeof fetch;
}): Promise<AuthCommandResult>;
export declare function runAuthStatus(cachePath?: string, now?: Date, env?: NodeJS.ProcessEnv): AuthCommandResult;
export declare function runAuthLogout(cachePath?: string): AuthCommandResult;
export declare function runAuthCommand(args: AuthCommandArgs, env?: NodeJS.ProcessEnv, deps?: {
    cachePath?: string;
    fetchImpl?: typeof fetch;
}): Promise<AuthCommandResult>;
//# sourceMappingURL=entitlement-cache.d.ts.map